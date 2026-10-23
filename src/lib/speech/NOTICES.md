# Speech dependency notices

The streaming capture, TEN-VAD wrapper, continuous feature calculation, sentence
merger, speech activity and single-flight decoder are adapted from Erik Landvall’s
AO example in llm-sds-01/inference/attempts/ao-browser-parakeet-streaming.
The initialization patch follows BS (bs-browser-parakeet-serial-init), extended to
CPU sessions too. Changes: application lifecycle, worker factory, pin verification,
optional runtime packaging and Settings UI. Their algorithms retain the AO behavior.

The model is NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0); browser ONNX files are a
maintainer conversion by ysdede, not NVIDIA-native ONNX artifacts. Immutable
provenance is recorded in model.lock.json. Model files download only on request.
https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx

## parakeet.js 1.4.4

https://github.com/ysdede/parakeet.js

MIT License

Copyright (c) 2025 Yunus Seyhan Dede

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ONNX Runtime Web 1.30.0

https://github.com/microsoft/onnxruntime/tree/v1.30.0
MIT License. Copyright (c) Microsoft Corporation. All rights reserved.
License and third-party notices: https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE
and https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt

## TEN-VAD

This third-party component has its own license, including additional conditions
from Agora. It is not covered by this application's AGPL license. The original
license and notices are retained verbatim in vendor/ten-vad, with pinned source
in source.json. Their text is reproduced below.

Open Source License

The ten-vad is licensed pursuant to the Apache License v2.0(provided
for your convenience below), with the
following additional conditions. You may reproduce, prepare Derivative Works
of, publicly display, publicly perform, sublicense, distribute, or otherwise
make available (together, "Deploy") the ten-vad, for commercial or
non-commercial purposes, provided that you agree to abide by the terms below:

    1. You may not Deploy the ten-vad in a way that competes with Agora's
       offerings and/or that allows others to compete with Agora's offerings,
       including without limitation enabling any third party to develop or
       deploy Applications.

    2. You may Deploy the ten-vad solely to create and enable deployment
       of your Application(s) solely for your benefit and the benefit of your
       direct End Users. If you prefer, you may include the following notice in
       the documentation of your Application(s): "Powered by ten-vad".

    3. Derivative Works of the ten-vad remain subject to this Open Source
       License.

    4. "End Users" shall mean the end-users of your Application(s) who access
       the ten-vad solely to the extent necessary to access and use the
       Application(s) you create or deploy using ten-vad.

    5. "Application(s)" shall mean your software programs designed or developed
       by using the ten-vad or where deployment is enabled by the ten-vad.

    6. Note that the project contains derived code from other open source project
       with BSD-3-Clause and BSD-2-Clause license, refer to the "NOTICES"
       file in the root directory for detailed information.


  Copyright © 2025 Agora

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.


This project includes modified code from the following third-party component:

1. File: lpcnet_enc.c
   - Source: LPCNet (https:github.com/xiph/LPCNet)
   - License: BSD-2-Clause
   - Copyright: 2017-2019, Mozilla
   - Original License Text:
        Copyright (c) 2017-2019 Mozilla

        Redistribution and use in source and binary forms, with or without modification,
        are permitted provided that the following conditions are met:

        - Redistributions of source code must retain the above copyright notice,
          this list of conditions and the following disclaimer.

        - Redistributions in binary form must reproduce the above copyright notice,
          this list of conditions and the following disclaimer in the documentation
          and/or other materials provided with the distribution.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
        ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
        LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
        A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION OR
        CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
        EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
        PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
        PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
        LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
        NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
        SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

2. Project: LPCNet
    - Source: LPCNet (https:github.com/xiph/LPCNet)
    - License: BSD-3-Clause
    - Copyright: 2017-2018, Mozilla, 2007-2017, Jean-Marc Valin, 2005-2017, Xiph.Org Foundation, 2003-2004, Mark Borgerding
    - Original License Text of LPCNet open source project:
        Copyright (c) 2017-2018, Mozilla
        Copyright (c) 2007-2017, Jean-Marc Valin
        Copyright (c) 2005-2017, Xiph.Org Foundation
        Copyright (c) 2003-2004, Mark Borgerding

        Redistribution and use in source and binary forms, with or without
        modification, are permitted provided that the following conditions
        are met:

        - Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.

        - Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

        - Neither the name of the Xiph.Org Foundation nor the names of its
        contributors may be used to endorse or promote products derived from
        this software without specific prior written permission.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
        ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
        LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
        A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
        OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
        SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
        LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
        DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
        THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
        (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
        OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.



MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
