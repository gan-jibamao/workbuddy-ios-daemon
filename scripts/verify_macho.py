#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建门禁：产物必须是 iOS 能加载的 Mach-O。

v2026.11.9-daemon 那版的教训：平台字段改对了、签名也过了，但
LC_LOAD_DYLIB 还写着 macOS 布局 /…/X.framework/Versions/A/X，
真机 dyld 直接 "Library not loaded … not in dyld cache"。
平台对 != 能加载，两条都要卡死。
"""
import hashlib
import struct
import sys

MH_MAGIC_64 = 0xFEEDFACF
LC_LOAD_DYLIB = 0xC
LC_LOAD_WEAK_DYLIB = 0x8000001C
LC_REEXPORT_DYLIB = 0x8000001F
LC_LAZY_LOAD_DYLIB = 0x20
LC_LOAD_UPWARD_DYLIB = 0x80000023
LC_BUILD_VERSION = 0x32
LC_CODE_SIGNATURE = 0x1D

DYLIB_CMDS = {LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB,
              LC_LAZY_LOAD_DYLIB, LC_LOAD_UPWARD_DYLIB}

# iOS 上真实存在的系统库。不在名单里一律红：宁可流水线挂，也不要再出
# 一个「装得上、dyld 起不来」的包。新增依赖时在这里补一行，别放宽成前缀匹配。
IOS_LIBS = {
    '/usr/lib/libSystem.B.dylib',
    '/usr/lib/libresolv.9.dylib',
    '/usr/lib/libc++.1.dylib',
    '/usr/lib/libobjc.A.dylib',
    '/usr/lib/libz.1.dylib',
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
    '/System/Library/Frameworks/Security.framework/Security',
    '/System/Library/Frameworks/Foundation.framework/Foundation',
}


def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)


def check_load_commands(d):
    ncmds = struct.unpack_from('<I', d, 16)[0]
    off, platform, libs = 32, None, []
    for _ in range(ncmds):
        cmd, size = struct.unpack_from('<II', d, off)
        if cmd == LC_BUILD_VERSION:
            platform = struct.unpack_from('<I', d, off + 8)[0]
        elif cmd in DYLIB_CMDS:
            noff = struct.unpack_from('<I', d, off + 8)[0]
            start = off + noff
            end = d.find(b'\0', start)
            if end < 0 or end > off + size:
                fail('LC_LOAD_DYLIB 字符串越界 @%#x' % off)
            libs.append(d[start:end].decode('utf-8', 'replace'))
        off += size

    if platform != 2:
        fail('LC_BUILD_VERSION platform=%r，期望 2(IOS)' % platform)
    if not libs:
        fail('没有 LC_LOAD_DYLIB，构建异常')

    bad = [n for n in libs if n not in IOS_LIBS]
    print('platform=IOS，依赖 %d 个：' % len(libs))
    for n in libs:
        print('   ', 'BAD' if n in bad else 'OK ', n)
    if bad:
        fail('非 iOS 路径（macOS 的 Versions/A 布局必然加载失败）：' + ', '.join(bad))


def check_signature(d):
    ncmds = struct.unpack_from('<I', d, 16)[0]
    off, cs = 32, None
    for _ in range(ncmds):
        cmd, size = struct.unpack_from('<II', d, off)
        if cmd == LC_CODE_SIGNATURE:
            cs = struct.unpack_from('<II', d, off + 8)
        off += size
    if cs is None:
        fail('没有 LC_CODE_SIGNATURE（没签名）')

    dataoff, datasize = cs
    blob = d[dataoff:dataoff + datasize]
    if len(blob) < 12:
        fail('LC_CODE_SIGNATURE 指向的数据太短')
    _, _, count = struct.unpack_from('>III', blob, 0)
    cd = None
    for i in range(count):
        t, o = struct.unpack_from('>II', blob, 12 + 8 * i)
        if t == 0:
            cd = blob[o:]
    if cd is None:
        fail('CodeDirectory(槽 0) 缺失')

    (_, _, _, _, hash_off, _, _, ncode, codelimit) = struct.unpack_from('>IIIIIIIII', cd, 0)
    hsize, htype, pageexp = cd[36], cd[37], cd[39]
    page = 1 << pageexp
    ok = bad = 0
    for i in range(ncode):
        s = i * page
        if s >= codelimit:
            break
        e = min(s + page, codelimit)
        want = cd[hash_off + i * hsize: hash_off + (i + 1) * hsize]
        got = hashlib.sha256(d[s:e]).digest() if htype == 2 else hashlib.sha1(d[s:e]).digest()
        if got == want:
            ok += 1
        else:
            bad += 1
    if bad:
        fail('签名页哈希不匹配 %d 页（是不是 patch 跑在 ldid 之后了？）' % bad)
    if dataoff != codelimit:
        fail('LC_CODE_SIGNATURE.dataoff(%#x) != codeLimit(%#x)' % (dataoff, codelimit))
    print('签名: %d/%d 页校验通过' % (ok, ok))


def main(path):
    d = open(path, 'rb').read()
    magic, cputype = struct.unpack_from('<Ii', d, 0)
    if magic != MH_MAGIC_64:
        fail('不是 64 位 Mach-O: %#x' % magic)
    if cputype != 0x0100000C:
        fail('不是 arm64: %#x' % cputype)
    check_load_commands(d)
    check_signature(d)
    print('verify_macho: 通过')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('用法: verify_macho.py <macho>')
    main(sys.argv[1])
