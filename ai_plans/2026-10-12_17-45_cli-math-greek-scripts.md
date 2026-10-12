# CLI: Greek letters in super- and subscripts

Status: done on `fix/cli-math-greek-scripts`

The owner's screenshot (2026-10-12) showed `f_θ` for `f_\theta`. `texToUnicode` writes a script in
Unicode script characters only when every character has one, else `_x` / `^x`. Unicode has no
subscript theta at all (only β γ ρ φ χ have subscripts), so `f_θ` is the best plain text can do and
stays. The maps now include the Greek script forms that exist: superscript α β γ δ ε θ ι φ χ and
subscript β γ ρ φ χ (both `\phi` and `\varphi`). Test: one row in `texToUnicode.test.ts`.
