# Third-party notices

DSP LabSim is MIT-licensed (see `LICENSE`). It contains or is derived from the following.

## Texas Instruments C6000 run-time support library

The C library emulation in `src/interp/runtime/` ports the behaviour of TI's C6000 run-time support
library (`ti-cgt-c6000_8.3.12/lib/src`: `_printfi.c`, `memory.c`, `setvbuf.c`, `rand.c`, `ctype.c` and
the math sources). The ELF test fixtures in `tests/fixtures/elf/` were built by TI's C6000 compiler
and contain parts of that library.

```
Copyright (c) 1995 Texas Instruments Incorporated
http://www.ti.com/

 Redistribution and  use in source  and binary forms, with  or without
 modification,  are permitted provided  that the  following conditions
 are met:

    Redistributions  of source  code must  retain the  above copyright
    notice, this list of conditions and the following disclaimer.

    Redistributions in binary form  must reproduce the above copyright
    notice, this  list of conditions  and the following  disclaimer in
    the  documentation  and/or   other  materials  provided  with  the
    distribution.

    Neither the  name of Texas Instruments Incorporated  nor the names
    of its  contributors may  be used to  endorse or  promote products
    derived  from   this  software  without   specific  prior  written
    permission.

 THIS SOFTWARE  IS PROVIDED BY THE COPYRIGHT  HOLDERS AND CONTRIBUTORS
 "AS IS"  AND ANY  EXPRESS OR IMPLIED  WARRANTIES, INCLUDING,  BUT NOT
 LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 SPECIAL,  EXEMPLARY,  OR CONSEQUENTIAL  DAMAGES  (INCLUDING, BUT  NOT
 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 THEORY OF  LIABILITY, WHETHER IN CONTRACT, STRICT  LIABILITY, OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

DSP LabSim does not include TI's compiler (`cl6x`). When Code Composer Studio is installed, LabSim runs
the user's own copy.

## Bundled in the app (MIT licence)

| Package | Copyright |
|---|---|
| Electron | Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. |
| Monaco Editor, `@monaco-editor/react` | Copyright (c) 2016 - present Microsoft Corporation; Copyright (c) 2018 Suren Atoyan |
| React, React DOM | Copyright (c) Meta Platforms, Inc. and affiliates |
| zustand | Copyright (c) 2019 Paul Henschel |

Electron also ships Chromium and Node.js; their licences are in `LICENSES.chromium.html` and
`LICENSE.electron.txt` next to the app's executable.
