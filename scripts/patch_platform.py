#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 Go 产出的 darwin/arm64 二进制改写成 iOS 平台。

Go 的 GOOS=ios 必须开 cgo（"ios/arm64 requires external (cgo) linking"），
而我们的构建机没有 iOS SDK，只能走这条路：先用 darwin/arm64 编出来，再把
Mach-O 的 platform 字段从 MACOS(1) 改成 IOS(2)，最后 ldid 签名。
越狱环境下 amfid 被绕过，ad-hoc 签名即可运行。

改两处（存在才改）：
  LC_BUILD_VERSION(0x32)        platform: 1 -> 2
  LC_VERSION_MIN_MACOSX(0x24)   cmd: 0x24 -> LC_VERSION_MIN_IPHONEOS(0x25)
"""
import struct
import sys

LC_VERSION_MIN_MACOSX = 0x24
LC_VERSION_MIN_IPHONEOS = 0x25
LC_BUILD_VERSION = 0x32
MH_MAGIC_64 = 0xfeedfacf


def main(path):
    data = bytearray(open(path, 'rb').read())
    magic, cputype, cpusub, ftype, ncmds, sizeofcmds, flags, rsv = struct.unpack('<IiiIIIII', data[:32])
    if magic != MH_MAGIC_64:
        raise SystemExit('不是 64 位 Mach-O: %#x' % magic)
    if cputype != 0x0100000C:  # CPU_TYPE_ARM64
        raise SystemExit('不是 arm64: %#x' % cputype)

    off = 32
    changed = []
    for _ in range(ncmds):
        cmd, size = struct.unpack('<II', data[off:off + 8])
        if cmd == LC_BUILD_VERSION:
            platform = struct.unpack('<I', data[off + 8:off + 12])[0]
            if platform != 2:
                struct.pack_into('<I', data, off + 8, 2)  # PLATFORM_IOS
                changed.append('LC_BUILD_VERSION platform %d -> 2' % platform)
        elif cmd == LC_VERSION_MIN_MACOSX:
            struct.pack_into('<I', data, off, LC_VERSION_MIN_IPHONEOS)
            changed.append('LC_VERSION_MIN_MACOSX -> LC_VERSION_MIN_IPHONEOS')
        off += size

    if not changed:
        raise SystemExit('没找到任何平台字段，构建可能已经变了')

    open(path, 'wb').write(data)
    print('已改写:')
    for c in changed:
        print('  -', c)


if __name__ == '__main__':
    main(sys.argv[1])
