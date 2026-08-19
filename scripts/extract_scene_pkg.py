#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Wallpaper Engine 的 .pkg (PKGV 容器) 中提取图片 / 视频 / 全部文件。

用法:
    python extract_scene_pkg.py <scene.pkg> [输出目录]
    python extract_scene_pkg.py <scene.pkg> --list        # 只列出包内文件
    python extract_scene_pkg.py <scene.pkg> --images-only # 只提取图片/视频(跳过 json/字体/着色器)

支持的内容类型:
    * .tex (TEXV0005 容器):
        - 内嵌 JPEG  -> .jpg
        - 内嵌 MP4 视频 -> .mp4
        - DXT1/DXT3/DXT5 -> .dds (+ 若有 Pillow 再转 .png)
        - RGBA8888 / R8 裸像素 -> .png
        - 每个 mipmap 的 isLZ4 压缩自动解压(优先用 lz4 库, 否则纯 Python 解码)
    * 其余文件 (json/ttf/着色器...) 原样导出

依赖: 仅 Pillow 可选(用于 DXT -> PNG; 没有也能导出 .dds/.jpg/.mp4)
"""

import os
import sys
import io
import re
import shutil
import struct

# ---------------------------------------------------------------------------
# LZ4 block 解压 (优先 lz4 库, 回退纯 Python 实现)
# ---------------------------------------------------------------------------

def _lz4_decode_pure(src: bytes, dst_size: int) -> bytes:
    """纯 Python 实现 LZ4 block 解压 (与 LZ4_decompress_safe 兼容)。"""
    out = bytearray()
    pos = 0
    n = len(src)
    while pos < n and len(out) < dst_size:
        token = src[pos]; pos += 1

        # 字面量长度
        lit_len = token >> 4
        if lit_len == 15:
            while True:
                b = src[pos]; pos += 1
                lit_len += b
                if b != 255:
                    break
        out += src[pos:pos + lit_len]
        pos += lit_len
        if pos >= n:
            break

        # 匹配: 2 字节 offset 在前, match 长度扩展在后 (LZ4 block 标准顺序)
        offset = src[pos] | (src[pos + 1] << 8)
        pos += 2
        match_len = token & 0x0F
        if match_len == 15:
            while True:
                b = src[pos]; pos += 1
                match_len += b
                if b != 255:
                    break
        match_len += 4  # 最小匹配 4 字节
        if offset == 0 or offset > len(out):
            raise ValueError("LZ4 数据损坏: 非法匹配偏移")
        start = len(out) - offset
        # 逐字节拷贝以正确处理重叠匹配
        for i in range(match_len):
            out.append(out[start + i])
    if len(out) != dst_size:
        raise ValueError(f"LZ4 解压后大小 {len(out)} != 预期 {dst_size}")
    return bytes(out)


def lz4_decompress(src: bytes, dst_size: int) -> bytes:
    try:
        import lz4.block  # type: ignore
        return lz4.block.decompress(src, uncompressed_size=dst_size)
    except ImportError:
        return _lz4_decode_pure(src, dst_size)


# ---------------------------------------------------------------------------
# PKG 容器解析 (PKGV0024)
# ---------------------------------------------------------------------------

def parse_pkg(path: str):
    """返回 (magic, entries, data_start)。entries: [(name, offset, length)]"""
    with open(path, "rb") as f:
        magic_len = struct.unpack("<I", f.read(4))[0]
        magic = f.read(magic_len).decode("ascii", "replace")
        count = struct.unpack("<I", f.read(4))[0]
        entries = []
        for _ in range(count):
            nl = struct.unpack("<I", f.read(4))[0]
            name = f.read(nl).decode("utf-8", "replace")
            off = struct.unpack("<I", f.read(4))[0]
            ln = struct.unpack("<I", f.read(4))[0]
            entries.append((name, off, ln))
        data_start = f.tell()
    return magic, entries, data_start


def read_entry(path: str, data_start: int, off: int, ln: int) -> bytes:
    with open(path, "rb") as f:
        f.seek(data_start + off)
        return f.read(ln)


# ---------------------------------------------------------------------------
# TEX 纹理容器解析 (TEXV0005 / TEXI0001 / TEXB0004)
# ---------------------------------------------------------------------------

class TEXHeader:
    def __init__(self, fmt, flags, tex_w, tex_h, img_w, img_h, unk):
        self.format = fmt        # 0 RGBA8888 4 DXT5 6 DXT3 7 DXT1 8 RG88 9 R8
        self.flags = flags
        self.tex_w, self.tex_h = tex_w, tex_h
        self.img_w, self.img_h = img_w, img_h
        self.unk = unk

    @property
    def is_video(self):
        return bool(self.flags & 0x20)          # TexFlags.IsVideoTexture

    @property
    def is_gif(self):
        return bool(self.flags & 0x04)          # TexFlags.IsGif


# FreeImage 格式号 (与 RePKG 一致): 值 -> 文件扩展名
FIF_EXT = {0: "bmp", 1: "ico", 2: "jpg", 3: "jng", 5: "iff", 6: "mng",
           7: "pbm", 8: "pbm", 9: "pcd", 10: "pcx", 11: "pgm", 12: "pgm",
           13: "png", 14: "ppm", 15: "ppm", 16: "ras", 17: "tga", 18: "tif",
           19: "wbmp", 20: "psd", 21: "cut", 22: "xbm", 23: "xpm", 24: "dds",
           25: "gif", 26: "hdr", 28: "sgi", 29: "exr", 30: "j2k", 31: "jp2",
           32: "pfm", 33: "pict", 34: "raw", 35: "mp4"}
DXT_FOURCC = {4: b"DXT5", 6: b"DXT3", 7: b"DXT1"}


def read_nstring(data: bytes, pos: int):
    end = data.index(0, pos)
    return data[pos:end].decode("utf-8", "replace"), end + 1


def parse_tex(data: bytes):
    """解析 TEX 容器, 返回 (header, images)。
    images: 每项为 [ (width, height, raw_bytes), ... ] mipmap 列表 (已解压)。"""
    p = 0
    m1, p = read_nstring(data, p)          # TEXV0005
    m2, p = read_nstring(data, p)          # TEXI0001
    if m1 != "TEXV0005" or m2 != "TEXI0001":
        raise ValueError(f"未知 TEX 魔数: {m1} / {m2}")
    fmt, flags, tw, th, iw, ih, unk = struct.unpack_from("<7I", data, p)
    p += 28
    header = TEXHeader(fmt, flags, tw, th, iw, ih, unk)

    m3, p = read_nstring(data, p)          # TEXB0003 / TEXB0004
    if not m3.startswith("TEXB"):
        raise ValueError(f"未知图像容器魔数: {m3}")
    ver = m3[4:] if len(m3) >= 8 else m3
    if ver == "0004":
        # TEXB0004: imageCount, imageFormat, isVideo
        img_count, image_format, _is_video = struct.unpack_from("<3i", data, p)
        p += 12
    elif ver == "0003":
        # TEXB0003: imageCount, imageFormat
        img_count, image_format = struct.unpack_from("<2i", data, p)
        p += 8
    else:
        # TEXB0001/0002: 无 ImageFormat 字段
        img_count = struct.unpack_from("<i", data, p)[0]
        p += 4
        image_format = -1

    images = []
    for _ in range(img_count):
        mip_count = struct.unpack_from("<i", data, p)[0]
        p += 4
        mips = []
        for _ in range(mip_count):
            w, h, is_lz4, dec_count, byte_count = struct.unpack_from("<5i", data, p)
            p += 20
            raw = data[p:p + byte_count]
            p += byte_count
            if is_lz4:
                raw = lz4_decompress(raw, dec_count)
            mips.append((w, h, raw))
        images.append(mips)

    # GIF 精灵图帧信息 (TEXSxxxx) 若存在则跳过
    if p < len(data):
        try:
            m4, p2 = read_nstring(data, p)
            if m4.startswith("TEXS"):
                print(f"    注: 检测到 GIF 帧信息段 {m4}, 已跳过")
        except Exception:
            pass
    return header, images, image_format


def tex_payload_kind(header: TEXHeader, image_format: int, mips) -> str:
    """判断 mipmap 载荷类型: 'mp4' / 'dds' / 'raw' / 或图片扩展名 ('png','jpg',...)"""
    if header.is_video or image_format == 35:
        return "mp4"
    ext = FIF_EXT.get(image_format)
    if ext:
        return ext                    # 内嵌完整图片文件 (png/jpg/bmp/gif/dds...)
    # 根据头部字节兜底探测
    head = mips[0][2][:16]
    if b"ftyp" in head:
        return "mp4"
    if head[:2] == b"\xff\xd8":
        return "jpg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if header.format in DXT_FOURCC:
        return "dds"
    return "raw"


# ---------------------------------------------------------------------------
# DDS 打包 (用于 DXT 数据)
# ---------------------------------------------------------------------------

def build_dds(width: int, height: int, fourcc: bytes, mip_levels):
    """mip_levels: [(w, h, bytes), ...] (已解压)"""
    block_size = 8 if fourcc == b"DXT1" else 16
    hdr = bytearray(128)
    hdr[0:4] = b"DDS "
    struct.pack_into("<I", hdr, 4, 124)                     # dwSize
    struct.pack_into("<I", hdr, 8, 0x1007)                  # CAPS|HEIGHT|WIDTH|PIXELFORMAT
    struct.pack_into("<I", hdr, 12, height)                 # dwHeight
    struct.pack_into("<I", hdr, 16, width)                  # dwWidth
    w, h = mip_levels[0][0], mip_levels[0][1]
    pitch = max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * block_size
    struct.pack_into("<I", hdr, 20, pitch)                  # dwPitchOrLinearSize
    struct.pack_into("<I", hdr, 24, 0)                      # dwDepth
    struct.pack_into("<I", hdr, 28, len(mip_levels))        # dwMipMapCount
    struct.pack_into("<I", hdr, 76, 32)                     # pf.dwSize
    struct.pack_into("<I", hdr, 80, 0x4)                    # pf.dwFlags = DDPF_FOURCC
    hdr[84:88] = fourcc
    struct.pack_into("<I", hdr, 108, 0x401008)              # TEXTURE|MIPMAP|COMPLEX
    body = b"".join(m for _, _, m in mip_levels)
    return bytes(hdr) + body


def raw_to_png(w: int, h: int, data: bytes, fmt: int):
    """裸像素 -> PNG bytes; fmt: 0 RGBA8888, 9 R8。失败返回 None。"""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    try:
        if fmt == 0:      # RGBA8888
            img = Image.frombytes("RGBA", (w, h), data, "raw", "RGBA")
        elif fmt == 9:    # R8
            img = Image.frombytes("L", (w, h), data, "raw", "L")
        else:
            return None
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    except Exception as e:
        print(f"    警告: PNG 转换失败: {e}")
        return None


# ---------------------------------------------------------------------------
# 导出
# ---------------------------------------------------------------------------

def safe_relpath(name: str) -> str:
    parts = [p for p in name.replace("\\", "/").split("/") if p and p not in (".", "..")]
    parts = [p.strip() for p in parts]
    if not parts:
        raise ValueError(f"非法文件名: {name!r}")
    return os.path.join(*parts)


def write_output(out_dir: str, rel: str, data: bytes):
    path = os.path.join(out_dir, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


def export_tex(out_dir: str, name: str, data: bytes):
    """导出单个 .tex 条目为可查看的图片/视频。返回生成的路径列表。"""
    written = []
    header, images, image_format = parse_tex(data)
    base = os.path.splitext(safe_relpath(name))[0]

    for img_idx, mips in enumerate(images):
        if not mips:
            continue
        kind = tex_payload_kind(header, image_format, mips)
        suffix = f"_{img_idx}" if len(images) > 1 else ""
        w, h, payload = mips[0]

        if kind == "mp4":
            p = write_output(out_dir, f"{base}{suffix}.mp4", payload)
            written.append(p)
        elif kind == "dds" and image_format != 24:
            fourcc = DXT_FOURCC[header.format]
            dds = build_dds(w, h, fourcc, mips)
            p = write_output(out_dir, f"{base}{suffix}.dds", dds)
            written.append(p)
            png = dds_to_png(dds)
            if png:
                p = write_output(out_dir, f"{base}{suffix}.png", png)
                written.append(p)
        elif kind == "raw":
            png = raw_to_png(w, h, payload, header.format)
            if png:
                p = write_output(out_dir, f"{base}{suffix}.png", png)
                written.append(p)
            else:
                p = write_output(out_dir, f"{base}{suffix}.bin", payload)
                written.append(p)
        else:
            # 内嵌的完整图片/视频文件, 原样导出 (取最大的一级 mipmap)
            p = write_output(out_dir, f"{base}{suffix}.{kind}", payload)
            written.append(p)
    return written


def dds_to_png(dds: bytes):
    try:
        from PIL import Image  # type: ignore
        import io
        img = Image.open(io.BytesIO(dds))
        buf = io.BytesIO()
        img.convert("RGBA").save(buf, "PNG")
        return buf.getvalue()
    except ImportError:
        return None
    except Exception as e:
        print(f"    警告: DDS->PNG 失败: {e}")
        return None


# ---------------------------------------------------------------------------
# 创意工坊条目文件夹模式 (规律: ①直接 mp4/jpg  ②scene.pkg 内 tex ③preview.jpg 兜底)
# ---------------------------------------------------------------------------

MEDIA_RE = re.compile(r"\.(mp4|webm|jpg|jpeg|png|gif)$", re.IGNORECASE)
VIDEO_RE = re.compile(r"\.(mp4|webm)$", re.IGNORECASE)
DIRECT_IMG_RE = re.compile(r"^wallpaper\.(jpg|jpeg|png)$", re.IGNORECASE)


def tex_to_media(tex_bytes: bytes):
    """解析一个 .tex, 返回可展示媒体列表 [(kind, data, size)] (kind: mp4/jpg/png/...)。"""
    try:
        header, images, image_format = parse_tex(tex_bytes)
    except Exception:
        return []
    out = []
    for mips in images:
        if not mips:
            continue
        kind = tex_payload_kind(header, image_format, mips)
        if kind in ("dds", "raw"):
            continue  # DXT/裸像素在 JS 端无法直接显示, 交给 preview 兜底 (Python 端可另行全量解包)
        payload = mips[0][2]
        out.append((kind, payload, len(payload)))
    return out


def pick_best_media(pkg: str):
    """从 scene.pkg 提取并挑选最佳壁纸媒体 (视频优先, 其次最大图片)。返回 (kind, data) 或 None。"""
    try:
        magic, entries, data_start = parse_pkg(pkg)
    except Exception as e:
        print(f"    !! pkg 解析失败: {e}")
        return None
    best = None
    for name, off, ln in entries:
        if not name.lower().endswith(".tex"):
            continue
        try:
            data = read_entry(pkg, data_start, off, ln)
        except Exception:
            continue
        for kind, payload, size in tex_to_media(data):
            score = (0 if kind == "mp4" else 1, size)  # 视频优先, 其次按体积
            if best is None or score < best[0]:
                best = (score, kind, payload)
    return (best[1], best[2]) if best else None


def extract_folder(folder: str, outdir: str):
    """自动识别创意工坊条目文件夹并导出最佳壁纸 (jpg/mp4)。"""
    folder = os.path.abspath(folder)
    name = os.path.basename(folder.rstrip("/\\")) or "wallpaper"
    os.makedirs(outdir, exist_ok=True)
    print(f"条目: {name}  ({folder})")

    # 1) 直接是 mp4 / wallpaper.jpg 等, 无需解包
    for fn in sorted(os.listdir(folder)):
        fp = os.path.join(folder, fn)
        if not os.path.isfile(fp):
            continue
        if VIDEO_RE.search(fn) or DIRECT_IMG_RE.search(fn):
            ext = os.path.splitext(fn)[1].lower()
            dst = os.path.join(outdir, name + ext)
            shutil.copy2(fp, dst)
            print(f"  [直接文件] {fn} -> {os.path.basename(dst)}")
            return [dst]

    # 2) scene.pkg 解包
    pkg = os.path.join(folder, "scene.pkg")
    if os.path.isfile(pkg):
        print(f"  [pkg] {os.path.basename(pkg)} ({os.path.getsize(pkg):,} B)")
        picked = pick_best_media(pkg)
        if picked:
            kind, data = picked
            ext = {2: ".jpg", 13: ".png", 35: ".mp4", "jpg": ".jpg", "png": ".png", "mp4": ".mp4"}.get(kind, "." + str(kind))
            if ext.startswith(".") and not ext[1:].isalnum():
                ext = ".bin"
            dst = os.path.join(outdir, name + ext)
            with open(dst, "wb") as f:
                f.write(data)
            print(f"  [pkg→{kind}] 最佳壁纸 {os.path.basename(dst)} ({len(data):,} B)")
            return [dst]
        print("  !! pkg 内未找到可直接显示的图片/视频 (多为 DXT 场景/傀儡壁纸)")

    # 3) preview.jpg 兜底
    pv = os.path.join(folder, "preview.jpg")
    if os.path.isfile(pv):
        dst = os.path.join(outdir, name + "_preview.jpg")
        shutil.copy2(pv, dst)
        print(f"  [preview] -> {os.path.basename(dst)}")
        return [dst]

    print("  !! 未找到任何可用的壁纸媒体")
    return []


def main():
    import argparse
    ap = argparse.ArgumentParser(description="提取 Wallpaper Engine 壁纸 (scene.pkg 或创意工坊条目文件夹)")
    ap.add_argument("pkg", nargs="?", help="scene.pkg 路径")
    ap.add_argument("outdir", nargs="?", default=None, help="输出目录 (默认: 输入同目录下 <名称>_extracted)")
    ap.add_argument("--folder", metavar="DIR", help="创意工坊条目文件夹: 自动识别 (直接mp4 / scene.pkg / preview.jpg)")
    ap.add_argument("--out", metavar="DIR", help="输出目录 (覆盖默认)")
    ap.add_argument("--list", action="store_true", help="只列出包内文件")
    ap.add_argument("--images-only", action="store_true", help="只导出图片/视频, 跳过 json/字体/着色器等")
    args = ap.parse_args()
    if args.out:
        args.outdir = args.out

    if args.folder:
        out_dir = args.outdir or os.path.join(os.path.dirname(os.path.abspath(args.folder)),
                                              os.path.basename(args.folder.rstrip("/\\")) + "_extracted")
        extract_folder(args.folder, out_dir)
        print(f"\n完成 -> {out_dir}")
        return

    pkg = args.pkg
    if not pkg or not os.path.isfile(pkg):
        sys.exit("用法: python extract_scene_pkg.py <scene.pkg|--folder DIR> [输出目录]")

    magic, entries, data_start = parse_pkg(pkg)
    print(f"包: {os.path.basename(pkg)}  魔数: {magic}  条目: {len(entries)}")

    if args.list:
        for name, off, ln in entries:
            print(f"  {off:>10,}  {ln:>12,}  {name}")
        return

    out_dir = args.outdir or os.path.join(os.path.dirname(os.path.abspath(pkg)),
                                          os.path.splitext(os.path.basename(pkg))[0] + "_extracted")
    os.makedirs(out_dir, exist_ok=True)
    print(f"输出目录: {out_dir}")

    n_img = 0
    for name, off, ln in entries:
        data = read_entry(pkg, data_start, off, ln)
        if name.lower().endswith(".tex"):
            print(f"[tex] {name}  ({ln:,} B)")
            try:
                paths = export_tex(out_dir, name, data)
                for p in paths:
                    print(f"      -> {os.path.relpath(p, out_dir)}")
                n_img += len(paths)
            except Exception as e:
                print(f"      !! 解析失败: {e}")
        elif args.images_only:
            continue
        else:
            p = write_output(out_dir, safe_relpath(name), data)
            print(f"[raw] {name}  ({ln:,} B)")

    print(f"\n完成。共导出 {n_img} 个图片/视频文件 -> {out_dir}")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台避免乱码
    except Exception:
        pass
    main()
