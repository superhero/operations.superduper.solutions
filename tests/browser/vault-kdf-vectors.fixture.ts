// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Official PHC reference cases and independently compared libsodium 0.8.4 bytes.
export const vectors = {
  "referenceSource": "https://github.com/P-H-C/phc-winner-argon2/blob/f57e61e19229e23c4445b85494dbf7c07de721cb/src/test.c",
  "reference": [
    {
      "id": "phc-t2-m65536-p1",
      "password": "password",
      "salt": "somesalt",
      "memorySize": 65536,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"
    },
    {
      "id": "phc-t2-m256-p1",
      "password": "password",
      "salt": "somesalt",
      "memorySize": 256,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe"
    },
    {
      "id": "phc-t2-m256-p2",
      "password": "password",
      "salt": "somesalt",
      "memorySize": 256,
      "iterations": 2,
      "parallelism": 2,
      "hashLength": 32,
      "expected": "6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037"
    },
    {
      "id": "phc-t1-m65536-p1",
      "password": "password",
      "salt": "somesalt",
      "memorySize": 65536,
      "iterations": 1,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "f6a5adc1ba723dddef9b5ac1d464e180fcd9dffc9d1cbf76cca2fed795d9ca98"
    },
    {
      "id": "phc-t4-m65536-p1",
      "password": "password",
      "salt": "somesalt",
      "memorySize": 65536,
      "iterations": 4,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "9025d48e68ef7395cca9079da4c4ec3affb3c8911fe4f86d1a2520856f63172c"
    },
    {
      "id": "phc-other-password",
      "password": "differentpassword",
      "salt": "somesalt",
      "memorySize": 65536,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "0b84d652cf6b0c4beaef0dfe278ba6a80df6696281d7e0d2891b817d8c458fde"
    },
    {
      "id": "phc-other-salt",
      "password": "password",
      "salt": "diffsalt",
      "memorySize": 65536,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32,
      "expected": "bdf32b05ccc42eb15d58fd19b1f856b113da1e9a5874fdcc544308565aa8141c"
    }
  ],
  "comparison": [
    {
      "id": "vault-profile",
      "password": "vault qualification synthetic password",
      "saltHex": "000102030405060708090a0b0c0d0e0f",
      "memorySize": 65536,
      "iterations": 3,
      "parallelism": 1,
      "hashLength": 32
    },
    {
      "id": "unicode-utf8",
      "password": "café 🔐 保密",
      "saltHex": "101112131415161718191a1b1c1d1e1f",
      "memorySize": 8192,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32
    },
    {
      "id": "embedded-null-binary",
      "passwordHex": "00616263ff00807f",
      "saltHex": "202122232425262728292a2b2c2d2e2f",
      "memorySize": 8192,
      "iterations": 2,
      "parallelism": 1,
      "hashLength": 32
    }
  ]
};
