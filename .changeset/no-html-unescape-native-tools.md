---
"tumble-code": patch
---

Files written with write_to_file or apply_diff and commands run with execute_command now keep HTML entities such as `&quot;`, `&gt;` and `&amp;` exactly as the model wrote them, instead of decoding them for every non-Claude model (which broke Python code that handles entities and every edit of an XML attribute value).
