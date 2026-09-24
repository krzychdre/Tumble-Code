---
"tumble-code": patch
---

Z.ai GLM models can now give longer answers. GLM-4.5, GLM-4.6, GLM-4.7, GLM-5 and the GLM-4.6V vision models were limited to 16,384 output tokens although Z.ai allows 96K (GLM-4.5 family), 128K (GLM-4.6 and newer) or 32K (GLM-4.6V). By default they now use up to 20% of their context window (about 40,000 tokens on the 200K models, 26,215 on the 128K ones), and the Max Output Tokens slider in the provider settings lets you raise it up to the documented limit. GLM-4.5V now uses its documented 64K context window instead of 128K.
