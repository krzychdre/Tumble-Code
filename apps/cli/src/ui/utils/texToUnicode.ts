/**
 * A TeX formula as plain text (plan: 2026-10-12 cli math): `3x^3` reads
 * `3x³`, `\frac{1}{2}` reads `½`, `\int_{-\infty}^{0}` reads `∫_(-∞)⁰`.
 *
 * Used for inline math, which sits inside a line of text, and for display
 * math wherever an image cannot be drawn. It is an approximation: what has
 * no Unicode form keeps a readable ASCII shape (`a/b`, `^(...)`), and an
 * unknown command stays as written.
 */

const SYMBOLS: Record<string, string> = {
	// Greek
	alpha: "α",
	beta: "β",
	gamma: "γ",
	delta: "δ",
	epsilon: "ϵ",
	varepsilon: "ε",
	zeta: "ζ",
	eta: "η",
	theta: "θ",
	vartheta: "ϑ",
	iota: "ι",
	kappa: "κ",
	lambda: "λ",
	mu: "μ",
	nu: "ν",
	xi: "ξ",
	pi: "π",
	varpi: "ϖ",
	rho: "ρ",
	varrho: "ϱ",
	sigma: "σ",
	varsigma: "ς",
	tau: "τ",
	upsilon: "υ",
	phi: "ϕ",
	varphi: "φ",
	chi: "χ",
	psi: "ψ",
	omega: "ω",
	Gamma: "Γ",
	Delta: "Δ",
	Theta: "Θ",
	Lambda: "Λ",
	Xi: "Ξ",
	Pi: "Π",
	Sigma: "Σ",
	Upsilon: "Υ",
	Phi: "Φ",
	Psi: "Ψ",
	Omega: "Ω",
	varGamma: "Γ",
	varDelta: "Δ",
	varTheta: "Θ",
	varLambda: "Λ",
	varXi: "Ξ",
	varPi: "Π",
	varSigma: "Σ",
	varUpsilon: "Υ",
	varPhi: "Φ",
	varPsi: "Ψ",
	varOmega: "Ω",
	digamma: "ϝ",
	// Operators
	cdot: "·",
	times: "×",
	div: "÷",
	pm: "±",
	mp: "∓",
	ast: "∗",
	star: "⋆",
	circ: "∘",
	bullet: "•",
	oplus: "⊕",
	otimes: "⊗",
	cup: "∪",
	cap: "∩",
	setminus: "∖",
	land: "∧",
	wedge: "∧",
	lor: "∨",
	vee: "∨",
	neg: "¬",
	lnot: "¬",
	odot: "⊙",
	ominus: "⊖",
	oslash: "⊘",
	dagger: "†",
	dag: "†",
	ddagger: "‡",
	ddag: "‡",
	amalg: "⨿",
	sqcup: "⊔",
	sqcap: "⊓",
	uplus: "⊎",
	wr: "≀",
	diamond: "⋄",
	bigtriangleup: "△",
	bigtriangledown: "▽",
	triangleleft: "◁",
	triangleright: "▷",
	lhd: "◁",
	rhd: "▷",
	cdotp: "·",
	centerdot: "·",
	ldotp: ".",
	// Relations
	le: "≤",
	leq: "≤",
	ge: "≥",
	geq: "≥",
	ne: "≠",
	neq: "≠",
	ll: "≪",
	gg: "≫",
	approx: "≈",
	equiv: "≡",
	cong: "≅",
	sim: "∼",
	simeq: "≃",
	propto: "∝",
	in: "∈",
	notin: "∉",
	ni: "∋",
	subset: "⊂",
	supset: "⊃",
	subseteq: "⊆",
	supseteq: "⊇",
	mid: "∣",
	parallel: "∥",
	perp: "⊥",
	leqslant: "⩽",
	geqslant: "⩾",
	nleq: "≰",
	ngeq: "≱",
	nless: "≮",
	ngtr: "≯",
	lesssim: "≲",
	gtrsim: "≳",
	prec: "≺",
	succ: "≻",
	preceq: "⪯",
	succeq: "⪰",
	sqsubseteq: "⊑",
	sqsupseteq: "⊒",
	subsetneq: "⊊",
	supsetneq: "⊋",
	nsubseteq: "⊈",
	nsupseteq: "⊉",
	approxeq: "≊",
	asymp: "≍",
	doteq: "≐",
	triangleq: "≜",
	coloneqq: "≔",
	models: "⊨",
	vdash: "⊢",
	dashv: "⊣",
	bowtie: "⋈",
	nmid: "∤",
	nparallel: "∦",
	// Arrows
	to: "→",
	rightarrow: "→",
	leftarrow: "←",
	gets: "←",
	leftrightarrow: "↔",
	Rightarrow: "⇒",
	Leftarrow: "⇐",
	Leftrightarrow: "⇔",
	implies: "⟹",
	impliedby: "⟸",
	iff: "⟺",
	mapsto: "↦",
	uparrow: "↑",
	downarrow: "↓",
	longrightarrow: "⟶",
	longleftarrow: "⟵",
	longleftrightarrow: "⟷",
	Longrightarrow: "⟹",
	Longleftarrow: "⟸",
	Longleftrightarrow: "⟺",
	longmapsto: "⟼",
	updownarrow: "↕",
	Uparrow: "⇑",
	Downarrow: "⇓",
	Updownarrow: "⇕",
	nearrow: "↗",
	searrow: "↘",
	swarrow: "↙",
	nwarrow: "↖",
	hookrightarrow: "↪",
	hookleftarrow: "↩",
	rightleftharpoons: "⇌",
	leftrightharpoons: "⇋",
	leftrightarrows: "⇆",
	rightleftarrows: "⇄",
	rightharpoonup: "⇀",
	leftharpoonup: "↼",
	// Big operators and other symbols
	int: "∫",
	iint: "∬",
	iiint: "∭",
	oint: "∮",
	sum: "∑",
	prod: "∏",
	coprod: "∐",
	bigcup: "⋃",
	bigcap: "⋂",
	bigoplus: "⨁",
	bigotimes: "⨂",
	bigodot: "⨀",
	bigsqcup: "⨆",
	bigvee: "⋁",
	bigwedge: "⋀",
	biguplus: "⨄",
	infty: "∞",
	partial: "∂",
	nabla: "∇",
	forall: "∀",
	exists: "∃",
	nexists: "∄",
	emptyset: "∅",
	varnothing: "∅",
	angle: "∠",
	triangle: "△",
	degree: "°",
	prime: "′",
	hbar: "ℏ",
	ell: "ℓ",
	Re: "ℜ",
	Im: "ℑ",
	aleph: "ℵ",
	beth: "ℶ",
	wp: "℘",
	mho: "℧",
	eth: "ð",
	imath: "ı",
	jmath: "ȷ",
	complement: "∁",
	top: "⊤",
	bot: "⊥",
	flat: "♭",
	sharp: "♯",
	natural: "♮",
	clubsuit: "♣",
	diamondsuit: "♢",
	heartsuit: "♡",
	spadesuit: "♠",
	Box: "□",
	square: "□",
	blacksquare: "■",
	Diamond: "◇",
	lozenge: "◊",
	surd: "√",
	backslash: "\\",
	S: "§",
	P: "¶",
	copyright: "©",
	pounds: "£",
	therefore: "∴",
	because: "∵",
	ldots: "…",
	dots: "…",
	cdots: "⋯",
	vdots: "⋮",
	ddots: "⋱",
	iddots: "⋰",
	langle: "⟨",
	rangle: "⟩",
	lbrace: "{",
	rbrace: "}",
	lbrack: "[",
	rbrack: "]",
	lceil: "⌈",
	rceil: "⌉",
	lfloor: "⌊",
	rfloor: "⌋",
	lvert: "|",
	rvert: "|",
	vert: "|",
	lVert: "‖",
	rVert: "‖",
	Vert: "‖",
	checkmark: "✓",
	// Spacing
	quad: "  ",
	qquad: "   ",
	",": " ",
	":": " ",
	";": " ",
	" ": " ",
	"!": "",
	// Escaped characters
	"{": "{",
	"}": "}",
	"|": "‖",
	"%": "%",
	$: "$",
	"&": "&",
	"#": "#",
	_: "_",
	"\\": "; ",
}

/** Commands that are written as their name: `\sin x` reads `sin x`. */
const FUNCTIONS = new Set(
	"sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp lim liminf limsup max min sup inf det dim ker arg deg gcd lcm Pr mod".split(
		" ",
	),
)

/** Commands that only change size, style or spacing: dropped. */
const IGNORED = new Set(
	"left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits nonumber notag".split(
		" ",
	),
)

/** Commands whose argument is prose, shown as it is. */
const TEXT_COMMANDS = new Set("text textrm textit textbf textsf texttt textnormal mbox hbox".split(" "))

/**
 * Commands that only style their argument, which is still math:
 * `\boldsymbol{\tau}` reads `τ`, not `\tau`.
 */
const STYLE_COMMANDS = new Set(
	"mathrm mathit mathbf mathsf mathtt mathcal mathscr mathfrak mathnormal boldsymbol bm operatorname mathbin mathrel mathop mathord boxed cancel bcancel xcancel substack".split(
		" ",
	),
)

/** Commands dropped together with their argument. */
const IGNORED_WITH_ARGUMENT = new Set("phantom hphantom vphantom vspace color label".split(" "))

const ACCENTS: Record<string, string> = {
	vec: "⃗",
	overrightarrow: "⃗",
	overleftarrow: "⃖",
	hat: "̂",
	widehat: "̂",
	check: "̌",
	breve: "̆",
	acute: "́",
	grave: "̀",
	mathring: "̊",
	bar: "̄",
	overline: "̅",
	underline: "̲",
	tilde: "̃",
	widetilde: "̃",
	dot: "̇",
	ddot: "̈",
}

/** Accents that span their whole argument: `\overline{AB}` reads `A̅B̅`. */
const SPANNING_ACCENTS = new Set(["overline", "underline"])

const ENVIRONMENT_BRACKETS: Record<string, [string, string]> = {
	pmatrix: ["(", ")"],
	bmatrix: ["[", "]"],
	Bmatrix: ["{", "}"],
	vmatrix: ["|", "|"],
	Vmatrix: ["‖", "‖"],
	cases: ["{ ", ""],
}

const SUPERSCRIPTS: Record<string, string> = Object.fromEntries(
	[..."0123456789+-=()niabcdefghjklmoprstuvwxyzABDEGHIJKLMNOPRTUVW"].map((c, i) => [
		c,
		[..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ"][i]!,
	]),
)
SUPERSCRIPTS["′"] = "′"

const SUBSCRIPTS: Record<string, string> = Object.fromEntries(
	[..."0123456789+-=()aehijklmnoprstuvx"].map((c, i) => [c, [..."₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"][i]!]),
)

// The few Greek letters Unicode has script forms for; θ, for one, has no
// subscript, so `f_\theta` stays `f_θ`.
Object.assign(SUPERSCRIPTS, { α: "ᵅ", β: "ᵝ", γ: "ᵞ", δ: "ᵟ", ε: "ᵋ", ϵ: "ᵋ", θ: "ᶿ", ι: "ᶥ", ϕ: "ᵠ", φ: "ᵠ", χ: "ᵡ" })
Object.assign(SUBSCRIPTS, { β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", ϕ: "ᵩ", φ: "ᵩ", χ: "ᵪ" })

const VULGAR_FRACTIONS: Record<string, string> = {
	"1/2": "½",
	"1/3": "⅓",
	"2/3": "⅔",
	"1/4": "¼",
	"3/4": "¾",
	"1/5": "⅕",
	"2/5": "⅖",
	"3/5": "⅗",
	"4/5": "⅘",
	"1/6": "⅙",
	"5/6": "⅚",
	"1/8": "⅛",
	"3/8": "⅜",
	"5/8": "⅝",
	"7/8": "⅞",
}

/** Double-struck capitals outside the Mathematical Alphanumeric block. */
const DOUBLE_STRUCK: Record<string, string> = { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" }

interface Reader {
	tex: string
	pos: number
}

export function texToUnicode(tex: string): string {
	return readSequence({ tex, pos: 0 }, undefined)
		.replace(/[ \t\n]+/g, " ")
		.trim()
}

/** Everything up to `closer` (consumed) or the end. */
function readSequence(reader: Reader, closer: string | undefined): string {
	let out = ""
	while (reader.pos < reader.tex.length) {
		const char = reader.tex[reader.pos]!
		if (char === closer) {
			reader.pos++
			return out
		}
		if (char === "^" || char === "_") {
			reader.pos++
			out += script(readArgument(reader), char === "^" ? SUPERSCRIPTS : SUBSCRIPTS, char)
			continue
		}
		out += readAtom(reader)
	}
	return out
}

/** One character, group or command. */
function readAtom(reader: Reader): string {
	const char = reader.tex[reader.pos++]!
	if (char === "{") {
		return readSequence(reader, "}")
	}
	if (char === "\\") {
		return readCommand(reader)
	}
	if (char === "&" || char === "~") {
		return " "
	}
	return char
}

/** A command's argument: a group, a command or one character, after spaces. */
function readArgument(reader: Reader): string {
	while (/\s/.test(reader.tex[reader.pos] ?? "")) {
		reader.pos++
	}
	return reader.pos < reader.tex.length ? readAtom(reader) : ""
}

/** A `{...}` argument as written, for `\text`; anything else is read as an argument. */
function readRawArgument(reader: Reader): string {
	while (/\s/.test(reader.tex[reader.pos] ?? "")) {
		reader.pos++
	}
	if (reader.tex[reader.pos] !== "{") {
		return readArgument(reader)
	}
	let depth = 0
	const start = reader.pos + 1
	for (; reader.pos < reader.tex.length; reader.pos++) {
		const char = reader.tex[reader.pos]
		if (char === "\\") {
			reader.pos++
		} else if (char === "{") {
			depth++
		} else if (char === "}" && --depth === 0) {
			return reader.tex.slice(start, reader.pos++)
		}
	}
	return reader.tex.slice(start)
}

/** The text in `[...]` after a command (`\sqrt[3]`), or undefined when there is none. */
function readOptional(reader: Reader): string | undefined {
	if (reader.tex[reader.pos] !== "[") {
		return undefined
	}
	const end = reader.tex.indexOf("]", reader.pos)
	if (end === -1) {
		return undefined
	}
	const inner = reader.tex.slice(reader.pos + 1, end)
	reader.pos = end + 1
	return texToUnicode(inner)
}

function readCommand(reader: Reader): string {
	const name = /^[a-zA-Z]+/.exec(reader.tex.slice(reader.pos))?.[0] ?? reader.tex[reader.pos] ?? ""
	reader.pos += name.length

	if (name in SYMBOLS) {
		return SYMBOLS[name]!
	}
	if (FUNCTIONS.has(name)) {
		return name
	}
	if (IGNORED.has(name)) {
		// `\left.` is an invisible delimiter.
		if (reader.tex[reader.pos] === ".") {
			reader.pos++
		}
		return ""
	}
	if (TEXT_COMMANDS.has(name)) {
		return readRawArgument(reader)
	}
	if (STYLE_COMMANDS.has(name)) {
		return readArgument(reader)
	}
	if (IGNORED_WITH_ARGUMENT.has(name)) {
		readRawArgument(reader)
		return ""
	}
	if (name in ACCENTS) {
		const base = readArgument(reader)
		if (SPANNING_ACCENTS.has(name)) {
			return [...base].map((char) => char + ACCENTS[name]).join("")
		}
		return [...base].length === 1 ? base + ACCENTS[name] : base
	}

	switch (name) {
		case "frac":
		case "dfrac":
		case "tfrac":
		case "cfrac":
			return fraction(readArgument(reader), readArgument(reader))
		case "sqrt": {
			const index = readOptional(reader)
			const radicand = readArgument(reader)
			const root =
				index === "3" ? "∛" : index === "4" ? "∜" : index ? `${script(index, SUPERSCRIPTS, "^")}√` : "√"
			return root + wrap(radicand)
		}
		case "binom":
		case "dbinom":
		case "tbinom":
			return `C(${readArgument(reader)}, ${readArgument(reader)})`
		case "mathbb":
			return [...readArgument(reader)].map(doubleStruck).join("")
		case "not": {
			const negated = readArgument(reader)
			return negated === "=" ? "≠" : negated + "̸"
		}
		case "pmod":
			return ` (mod ${readArgument(reader)})`
		case "overset":
		case "stackrel": {
			const over = readArgument(reader)
			return readArgument(reader) + script(over, SUPERSCRIPTS, "^")
		}
		case "underset": {
			const under = readArgument(reader)
			return readArgument(reader) + script(under, SUBSCRIPTS, "_")
		}
		case "xrightarrow":
		case "xleftarrow": {
			readOptional(reader)
			const label = readArgument(reader)
			return (name === "xrightarrow" ? "→" : "←") + (label ? script(label, SUPERSCRIPTS, "^") : "")
		}
		case "textcolor":
			readRawArgument(reader)
			return readArgument(reader)
		case "hspace":
			readRawArgument(reader)
			return " "
		case "tag":
			return ` (${readArgument(reader)})`
		case "bra":
			return `⟨${readArgument(reader)}|`
		case "ket":
			return `|${readArgument(reader)}⟩`
		case "braket":
			return `⟨${readArgument(reader)}⟩`
		case "begin":
			return ENVIRONMENT_BRACKETS[readRawArgument(reader)]?.[0] ?? ""
		case "end":
			return ENVIRONMENT_BRACKETS[readRawArgument(reader)]?.[1] ?? ""
		default:
			// Unknown: as written, with its argument.
			return reader.tex[reader.pos] === "{" ? `\\${name}{${readRawArgument(reader)}}` : `\\${name}`
	}
}

/** `text` in super- or subscript characters, or `^(text)` when one has none. */
function script(text: string, map: Record<string, string>, mark: string): string {
	const chars = [...text.replace(/\s+/g, "")]
	if (chars.length > 0 && chars.every((char) => char in map)) {
		return chars.map((char) => map[char]).join("")
	}
	const trimmed = text.trim()
	return mark + ([...trimmed].length <= 1 ? trimmed : `(${trimmed})`)
}

function fraction(numerator: string, denominator: string): string {
	const [top, bottom] = [numerator.trim(), denominator.trim()]
	return VULGAR_FRACTIONS[`${top}/${bottom}`] ?? `${wrap(top)}/${wrap(bottom)}`
}

/** `text` in parentheses unless it is a single term. */
function wrap(text: string): string {
	return /^[\p{L}\p{N}.′∞]*$/u.test(text) || /^\(.*\)$/.test(text) ? text : `(${text})`
}

function doubleStruck(char: string): string {
	if (char in DOUBLE_STRUCK) {
		return DOUBLE_STRUCK[char]!
	}
	if (/[A-Z]/.test(char)) {
		return String.fromCodePoint(0x1d538 + char.charCodeAt(0) - 65)
	}
	if (/[a-z]/.test(char)) {
		return String.fromCodePoint(0x1d552 + char.charCodeAt(0) - 97)
	}
	return char
}
