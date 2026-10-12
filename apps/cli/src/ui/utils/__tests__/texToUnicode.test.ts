import { texToUnicode } from "../texToUnicode.js"

describe("texToUnicode", () => {
	it.each([
		// The formulas of the 2026-10-12 screenshot.
		[String.raw`\int_{-\infty}^{0} \left(3x^3 + 6x + \frac{1}{2}\right) dx`, "∫_(-∞)⁰ (3x³ + 6x + ½) dx"],
		[String.raw`\frac{3}{4}x^4 + 3x^2 + \frac{x}{2} + C`, "¾x⁴ + 3x² + x/2 + C"],
		[String.raw`\lim_{a \to -\infty} \Big[F(0) - F(a)\Big]`, "lim_(a → -∞) [F(0) - F(a)]"],
		[String.raw`-\infty \quad \text{(rozbieżna)}`, "-∞ (rozbieżna)"],
		// Scripts: Unicode where every character has a form, ^(...) otherwise.
		[String.raw`x^{-1} + y_{n+1}`, "x⁻¹ + yₙ₊₁"],
		[String.raw`e^{i\pi} + 1 = 0`, "e^(iπ) + 1 = 0"],
		[String.raw`|x|^3`, "|x|³"],
		// Fractions, roots, sets, accents, environments.
		[String.raw`\frac{n(n+1)}{2}`, "(n(n+1))/2"],
		[String.raw`\sqrt{x^2 + 1} \ne \sqrt[3]{8}`, "√(x² + 1) ≠ ∛8"],
		[String.raw`\mathbb{R}^n \ni \vec{v}`, "ℝⁿ ∋ v⃗"],
		[String.raw`\alpha \le \beta \Rightarrow \sin\theta \cdot \pi`, "α ≤ β ⇒ sinθ · π"],
		[String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, "( a b ; c d )"],
		[String.raw`\binom{n}{k} \pmod{p}`, "C(n, k) (mod p)"],
		// Style commands read their argument as math (the 2026-10-12 spinning top screenshot).
		[String.raw`\boldsymbol{\tau} = \dot{\mathbf{L}} = \boldsymbol{\Omega}_P \times \mathbf{L}`, "τ = L̇ = Ω_P × L"],
		[String.raw`\mathrm{d}\theta + \operatorname{tr}(\mathbf{A})`, "dθ + tr(A)"],
		[String.raw`\text{\alpha}`, String.raw`\alpha`],
		// Less common symbols, accents and argument commands.
		[String.raw`\varOmega \leqslant \Longrightarrow \hookrightarrow \bigoplus \dagger \models`, "Ω ⩽ ⟹ ↪ ⨁ † ⊨"],
		[String.raw`\overline{AB} \perp \check{x}`, "A̅B̅ ⊥ x̌"],
		[String.raw`\overset{\text{def}}{=} \underset{n}{\max} \xrightarrow{f}`, "=ᵈᵉᶠ maxₙ →ᶠ"],
		[String.raw`\phantom{x}\color{red} a \hspace{1em} \textcolor{blue}{b} \tag{1}`, "a b (1)"],
		[String.raw`\bra{\psi} \ket{\phi} \braket{x}`, "⟨ψ| |ϕ⟩ ⟨x⟩"],
		// An unknown command stays as written.
		[String.raw`\foo{x} + 1`, String.raw`\foo{x} + 1`],
	])("%s", (tex, text) => {
		expect(texToUnicode(tex)).toBe(text)
	})

	it("survives unbalanced input", () => {
		expect(texToUnicode(String.raw`\frac{1}{2`)).toBe("½")
		expect(texToUnicode("x^")).toBe("x^")
	})
})
