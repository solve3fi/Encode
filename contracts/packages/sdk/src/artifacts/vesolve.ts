/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vesolve.json`.
 */
export type Vesolve = {
  "address": "3D7d2uS93Wy2duPHAUD3YeZzaWMUJ5hhhH84VoSjRmNk",
  "metadata": {
    "name": "vesolve",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "claimBribeReward",
      "discriminator": [
        70,
        108,
        122,
        194,
        38,
        53,
        145,
        149
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "bribeVaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userRewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  98,
                  114,
                  105,
                  98,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "gauge"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "userVote",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "claimGaugeRewards",
      "discriminator": [
        116,
        6,
        11,
        147,
        169,
        97,
        231,
        18
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "gaugeReward",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "stake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "stake.position_mint",
                "account": "gaugeStake"
              }
            ]
          }
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "gaugeReward"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerRewardToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimPoolReward",
      "discriminator": [
        184,
        228,
        250,
        102,
        47,
        97,
        202,
        169
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenMintA",
          "writable": true
        },
        {
          "name": "userTokenAccountA",
          "writable": true
        },
        {
          "name": "vaultTokenAccountA",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenMintB",
          "writable": true
        },
        {
          "name": "userTokenAccountB",
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userRewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  111,
                  108,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "userVote",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "claimReward",
      "discriminator": [
        149,
        95,
        181,
        242,
        94,
        90,
        158,
        162
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userRewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "userVote",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "createBribe",
      "discriminator": [
        113,
        190,
        79,
        216,
        95,
        167,
        95,
        156
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "gauge"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "bribe",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  114,
                  105,
                  98,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "gauge"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "bribeTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createGauge",
      "discriminator": [
        36,
        92,
        148,
        102,
        185,
        224,
        141,
        126
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "gauge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "arg",
                "path": "poolAddress"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "poolAddress",
          "type": "pubkey"
        },
        {
          "name": "tokenMintA",
          "type": "pubkey"
        },
        {
          "name": "tokenMintB",
          "type": "pubkey"
        },
        {
          "name": "feeTier",
          "type": "u16"
        }
      ]
    },
    {
      "name": "createLock",
      "discriminator": [
        171,
        216,
        92,
        167,
        165,
        8,
        153,
        90
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "protocol.next_nft_token_id",
                "account": "protocol"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "protocolTokenAccount",
          "writable": true
        },
        {
          "name": "veMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "protocol.next_nft_token_id",
                "account": "protocol"
              }
            ]
          }
        },
        {
          "name": "veTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "veMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "metadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "unlockTime",
          "type": "i64"
        }
      ]
    },
    {
      "name": "distributePoolReward",
      "discriminator": [
        64,
        29,
        6,
        191,
        245,
        204,
        143,
        75
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "gauge"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "protocol.current_epoch",
                "account": "protocol"
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "tokenMintA",
          "writable": true
        },
        {
          "name": "userTokenAccountA",
          "writable": true
        },
        {
          "name": "vaultTokenAccountA",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenMintB",
          "writable": true
        },
        {
          "name": "userTokenAccountB",
          "writable": true
        },
        {
          "name": "vaultTokenAccountB",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "tokenAAmount",
          "type": "u64"
        },
        {
          "name": "tokenBAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "extendLock",
      "discriminator": [
        68,
        151,
        140,
        144,
        139,
        122,
        118,
        170
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        },
        {
          "name": "unlockTime",
          "type": "i64"
        }
      ]
    },
    {
      "name": "fundGaugeEmission",
      "discriminator": [
        252,
        102,
        115,
        138,
        69,
        247,
        221,
        40
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "votingEpoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "voting_epoch.epoch",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "epochEmission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "emissionEpoch"
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "gaugeReward",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "gaugeReward"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "emissionEpoch",
          "type": "u64"
        }
      ]
    },
    {
      "name": "increaseLock",
      "discriminator": [
        144,
        30,
        154,
        214,
        191,
        69,
        95,
        94
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "protocolTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "mintToken",
          "type": "pubkey"
        },
        {
          "name": "epochResetTime",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeEpochEmission",
      "discriminator": [
        205,
        152,
        57,
        9,
        89,
        23,
        81,
        15
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "votingEpoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "voting_epoch.epoch",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "epochEmission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "emissionEpoch"
              }
            ]
          }
        },
        {
          "name": "developerWallet"
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "developerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "developerWallet"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "emissionEpoch",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mergeLock",
      "discriminator": [
        202,
        9,
        224,
        201,
        187,
        79,
        97,
        248
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "primaryLock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "primaryVeTokenId"
              }
            ]
          }
        },
        {
          "name": "secondaryLock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "secondaryVeTokenId"
              }
            ]
          }
        },
        {
          "name": "secondaryVeMint",
          "writable": true
        },
        {
          "name": "secondaryVeTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "primaryVeTokenId",
          "type": "u64"
        },
        {
          "name": "secondaryVeTokenId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "splitLock",
      "discriminator": [
        136,
        245,
        154,
        28,
        13,
        99,
        169,
        146
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "veLock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        },
        {
          "name": "veLockMint",
          "writable": true
        },
        {
          "name": "veLockTokenAccount",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "protocol.next_nft_token_id",
                "account": "protocol"
              }
            ]
          }
        },
        {
          "name": "veMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "protocol.next_nft_token_id",
                "account": "protocol"
              }
            ]
          }
        },
        {
          "name": "veTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "veMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "metadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stakePosition",
      "discriminator": [
        240,
        103,
        193,
        67,
        155,
        210,
        8,
        142
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "gaugeReward",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "position"
        },
        {
          "name": "positionMint"
        },
        {
          "name": "stake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "ownerPositionToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "custodyPositionToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "stake"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "transferLock",
      "discriminator": [
        179,
        158,
        146,
        148,
        151,
        46,
        176,
        200
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        },
        {
          "name": "veMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "lock.ve_token_id",
                "account": "lock"
              }
            ]
          }
        },
        {
          "name": "veTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "destination"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unlockLock",
      "discriminator": [
        173,
        187,
        138,
        62,
        202,
        179,
        237,
        86
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "writable": true
        },
        {
          "name": "protocolTokenAccount",
          "writable": true
        },
        {
          "name": "veMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "lock.ve_token_id",
                "account": "lock"
              }
            ]
          }
        },
        {
          "name": "veTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "veMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unstakePosition",
      "discriminator": [
        245,
        166,
        108,
        248,
        248,
        168,
        247,
        20
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "gauge"
        },
        {
          "name": "gaugeReward",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "gauge"
              }
            ]
          }
        },
        {
          "name": "stake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  117,
                  103,
                  101,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ]
          }
        },
        {
          "name": "positionMint"
        },
        {
          "name": "custodyPositionToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "stake"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerPositionToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "gaugeReward"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerRewardToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "rewardMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateEpoch",
      "discriminator": [
        218,
        126,
        55,
        95,
        96,
        35,
        241,
        92
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "vote",
      "discriminator": [
        227,
        110,
        155,
        23,
        136,
        126,
        172,
        25
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "arg",
                "path": "veTokenId"
              }
            ]
          }
        },
        {
          "name": "userVote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "protocol.current_epoch",
                "account": "protocol"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "veTokenId",
          "type": "u64"
        },
        {
          "name": "gaugeVotes",
          "type": {
            "vec": {
              "defined": {
                "name": "gaugeVote"
              }
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bribe",
      "discriminator": [
        123,
        25,
        44,
        23,
        111,
        217,
        65,
        73
      ]
    },
    {
      "name": "claimedPoolRewards",
      "discriminator": [
        159,
        85,
        90,
        124,
        109,
        226,
        237,
        44
      ]
    },
    {
      "name": "claimedRewards",
      "discriminator": [
        105,
        246,
        152,
        121,
        249,
        99,
        139,
        216
      ]
    },
    {
      "name": "epoch",
      "discriminator": [
        93,
        83,
        120,
        89,
        151,
        138,
        152,
        108
      ]
    },
    {
      "name": "epochEmission",
      "discriminator": [
        244,
        35,
        123,
        118,
        9,
        87,
        238,
        76
      ]
    },
    {
      "name": "gauge",
      "discriminator": [
        9,
        19,
        249,
        189,
        158,
        171,
        226,
        205
      ]
    },
    {
      "name": "gaugeReward",
      "discriminator": [
        139,
        101,
        207,
        10,
        10,
        200,
        205,
        216
      ]
    },
    {
      "name": "gaugeStake",
      "discriminator": [
        189,
        104,
        126,
        117,
        61,
        97,
        146,
        208
      ]
    },
    {
      "name": "lock",
      "discriminator": [
        8,
        255,
        36,
        202,
        210,
        22,
        57,
        137
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "protocol",
      "discriminator": [
        45,
        39,
        101,
        43,
        115,
        72,
        131,
        40
      ]
    },
    {
      "name": "userVote",
      "discriminator": [
        136,
        163,
        243,
        202,
        202,
        124,
        112,
        53
      ]
    },
    {
      "name": "vaultData",
      "discriminator": [
        130,
        212,
        101,
        247,
        146,
        181,
        149,
        100
      ]
    }
  ],
  "events": [
    {
      "name": "epochUpdated",
      "discriminator": [
        215,
        144,
        235,
        56,
        98,
        151,
        50,
        121
      ]
    },
    {
      "name": "gaugeCreated",
      "discriminator": [
        33,
        207,
        242,
        96,
        58,
        181,
        242,
        167
      ]
    },
    {
      "name": "lockBurned",
      "discriminator": [
        12,
        186,
        210,
        201,
        110,
        225,
        251,
        234
      ]
    },
    {
      "name": "lockCreated",
      "discriminator": [
        244,
        216,
        59,
        77,
        83,
        47,
        61,
        196
      ]
    },
    {
      "name": "lockExtended",
      "discriminator": [
        25,
        118,
        227,
        150,
        119,
        138,
        207,
        234
      ]
    },
    {
      "name": "lockTransferred",
      "discriminator": [
        77,
        26,
        178,
        15,
        169,
        10,
        20,
        90
      ]
    },
    {
      "name": "lockUpdated",
      "discriminator": [
        41,
        78,
        115,
        6,
        136,
        17,
        235,
        229
      ]
    },
    {
      "name": "protocolInitialized",
      "discriminator": [
        173,
        122,
        168,
        254,
        9,
        118,
        76,
        132
      ]
    },
    {
      "name": "rewardClaimed",
      "discriminator": [
        49,
        28,
        87,
        84,
        158,
        48,
        229,
        175
      ]
    },
    {
      "name": "vaultCreated",
      "discriminator": [
        117,
        25,
        120,
        254,
        75,
        236,
        78,
        115
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "gaugeAlreadyExists",
      "msg": "Gauge already exists"
    },
    {
      "code": 6002,
      "name": "invalidMint",
      "msg": "Invalid mint"
    },
    {
      "code": 6003,
      "name": "invalidOwner",
      "msg": "Invalid owner"
    },
    {
      "code": 6004,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6005,
      "name": "invalidUnlockTime",
      "msg": "Invalid unlock time"
    },
    {
      "code": 6006,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account"
    },
    {
      "code": 6007,
      "name": "insufficientFunds",
      "msg": "Insufficient funds"
    },
    {
      "code": 6008,
      "name": "invalidVeTokenId",
      "msg": "Invalid ve token id"
    },
    {
      "code": 6009,
      "name": "lockExpired",
      "msg": "Lock expired"
    },
    {
      "code": 6010,
      "name": "cannotDecreaseLockTime",
      "msg": "Cannot decrease lock time"
    },
    {
      "code": 6011,
      "name": "invalidLock",
      "msg": "Invalid lock"
    },
    {
      "code": 6012,
      "name": "invalidEpoch",
      "msg": "Invalid epoch"
    },
    {
      "code": 6013,
      "name": "lockNotExpired",
      "msg": "Lock not expired"
    },
    {
      "code": 6014,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6015,
      "name": "invalidVotingPower",
      "msg": "Invalid voting power"
    },
    {
      "code": 6016,
      "name": "invalidGaugeVotes",
      "msg": "Invalid gauge votes"
    },
    {
      "code": 6017,
      "name": "voteExpired",
      "msg": "Vote expired"
    },
    {
      "code": 6018,
      "name": "invalidGauge",
      "msg": "Invalid gauge"
    },
    {
      "code": 6019,
      "name": "alreadyClaimed",
      "msg": "Already claimed"
    },
    {
      "code": 6020,
      "name": "lockHasActiveVotes",
      "msg": "Lock has active votes"
    },
    {
      "code": 6021,
      "name": "epochNotEnded",
      "msg": "Epoch has not ended"
    },
    {
      "code": 6022,
      "name": "votingRewardsNotClaimableYet",
      "msg": "Voting rewards become claimable after one complete additional epoch"
    },
    {
      "code": 6023,
      "name": "emissionAlreadyFunded",
      "msg": "Emission for this gauge and epoch has already been funded"
    },
    {
      "code": 6024,
      "name": "invalidStakeOwner",
      "msg": "This position is not staked by the signer"
    },
    {
      "code": 6025,
      "name": "positionHasNoLiquidity",
      "msg": "Position has no liquidity"
    },
    {
      "code": 6026,
      "name": "rewardPeriodNotInitialized",
      "msg": "Gauge reward period is not initialized"
    }
  ],
  "types": [
    {
      "name": "bribe",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bribeWeight",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimedPoolRewards",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          },
          {
            "name": "lastClaimTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "claimedRewards",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "lastClaimTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          },
          {
            "name": "totalVotingPower",
            "type": "u64"
          },
          {
            "name": "totalVotes",
            "type": "u64"
          },
          {
            "name": "gaugeWeights",
            "type": {
              "vec": {
                "defined": {
                  "name": "gaugeWeight"
                }
              }
            }
          },
          {
            "name": "bribes",
            "type": {
              "vec": {
                "defined": {
                  "name": "bribeWeight"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochEmission",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "totalEmission",
            "type": "u64"
          },
          {
            "name": "gaugeBudget",
            "type": "u64"
          },
          {
            "name": "developerAllocation",
            "type": "u64"
          },
          {
            "name": "distributedToGauges",
            "type": "u64"
          },
          {
            "name": "developerWallet",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "gauge",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolAddress",
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "feeTier",
            "type": "u16"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "gaugeCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolAddress",
            "type": "pubkey"
          },
          {
            "name": "tokenMintA",
            "type": "pubkey"
          },
          {
            "name": "tokenMintB",
            "type": "pubkey"
          },
          {
            "name": "feeTier",
            "type": "u16"
          },
          {
            "name": "isActive",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "gaugeReward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "totalStakedLiquidity",
            "type": "u128"
          },
          {
            "name": "rewardRateX64",
            "type": "u128"
          },
          {
            "name": "rewardPerLiquidityX64",
            "type": "u128"
          },
          {
            "name": "lastUpdateTime",
            "type": "i64"
          },
          {
            "name": "periodFinish",
            "type": "i64"
          },
          {
            "name": "lastFundedEpoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "gaugeStake",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "rewardPerLiquidityPaidX64",
            "type": "u128"
          },
          {
            "name": "accruedRewards",
            "type": "u64"
          },
          {
            "name": "stakedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "gaugeVote",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "weight",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "gaugeWeight",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "weight",
            "type": "u64"
          },
          {
            "name": "votes",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lock",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "veTokenId",
            "type": "u64"
          },
          {
            "name": "veMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "unlockTime",
            "type": "i64"
          },
          {
            "name": "votingPower",
            "type": "u64"
          },
          {
            "name": "lastVoteEpoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lockBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nftTokenId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lockCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nftTokenId",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "unlockTime",
            "type": "i64"
          },
          {
            "name": "votingPower",
            "type": "u64"
          },
          {
            "name": "lastVoteEpoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lockExtended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nftTokenId",
            "type": "u64"
          },
          {
            "name": "oldUnlockTime",
            "type": "i64"
          },
          {
            "name": "newUnlockTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lockTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "nftTokenId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lockUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nftTokenId",
            "type": "u64"
          },
          {
            "name": "oldAmount",
            "type": "u64"
          },
          {
            "name": "newAmount",
            "type": "u64"
          },
          {
            "name": "oldVotingPower",
            "type": "u64"
          },
          {
            "name": "newVotingPower",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "solve",
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "tickLowerIndex",
            "type": "i32"
          },
          {
            "name": "tickUpperIndex",
            "type": "i32"
          },
          {
            "name": "feeGrowthCheckpointA",
            "type": "u128"
          },
          {
            "name": "feeOwedA",
            "type": "u64"
          },
          {
            "name": "feeGrowthCheckpointB",
            "type": "u128"
          },
          {
            "name": "feeOwedB",
            "type": "u64"
          },
          {
            "name": "rewardInfos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "positionRewardInfo"
                  }
                },
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionRewardInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "growthInsideCheckpoint",
            "type": "u128"
          },
          {
            "name": "amountOwed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocol",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "nextNftTokenId",
            "type": "u64"
          },
          {
            "name": "totalSupply",
            "type": "u64"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "type": "u64"
          },
          {
            "name": "lastEmissionTime",
            "type": "i64"
          },
          {
            "name": "epochStartTime",
            "type": "i64"
          },
          {
            "name": "epochResetTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "protocolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "nextNftTokenId",
            "type": "u64"
          },
          {
            "name": "totalSupply",
            "type": "u64"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "type": "u64"
          },
          {
            "name": "epochStartTime",
            "type": "i64"
          },
          {
            "name": "epochResetTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userVote",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "totalVotingPower",
            "type": "u64"
          },
          {
            "name": "votes",
            "type": {
              "vec": {
                "defined": {
                  "name": "gaugeVote"
                }
              }
            }
          },
          {
            "name": "lastVoteTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "rewards",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "gauge",
            "type": "pubkey"
          },
          {
            "name": "rewards",
            "type": "u64"
          },
          {
            "name": "poolRewardsA",
            "type": "u64"
          },
          {
            "name": "poolRewardsB",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
