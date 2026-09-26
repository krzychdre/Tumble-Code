// Characterization of the i18next and react-i18next behaviour the webview relies
// on, run against the real setup (real English and lazily loaded locales, the
// real init options): interpolation without escaping, plural selection and its
// fallbacks, language fallback, missing keys, "$" sequences in values, and
// <Trans> with components and values. A major bump of either library must keep
// every expectation here, or the diff shows what users would see differently.

import { render } from "@testing-library/react"
import { Trans, useTranslation } from "react-i18next"

import i18next, { loadLanguage } from "../setup"

function Probe({ count }: { count: number }) {
	const { t } = useTranslation()
	return <span data-testid="probe">{t("chat:codebaseSearch.didSearch", { count })}</span>
}

describe("i18next behaviour used by the webview", () => {
	beforeAll(async () => {
		await Promise.all([loadLanguage("pl"), loadLanguage("fr")])
	})

	afterEach(async () => {
		await i18next.changeLanguage("en")
	})

	it("interpolates without HTML escaping (React escapes)", () => {
		expect(i18next.t("common:errors.wait_checkpoint_long_time", { timeout: "<b>5</b> & 'x'" })).toBe(
			"Waited <b>5</b> & 'x' seconds for checkpoint initialization. If you don't need the checkpoint feature, please turn it off in <settingsLink>the checkpoint settings</settingsLink>.",
		)
	})

	it("keeps $ sequences in interpolated values literal", () => {
		expect(i18next.t("common:errors.wait_checkpoint_long_time", { timeout: "$& $$ $' $`" })).toMatch(
			/^Waited \$& \$\$ \$' \$` seconds /,
		)
	})

	it("selects English plural forms by count", () => {
		expect(i18next.t("chat:codebaseSearch.didSearch", { count: 1 })).toBe("Found 1 result")
		expect(i18next.t("chat:codebaseSearch.didSearch", { count: 0 })).toBe("Found 0 results")
		expect(i18next.t("chat:codebaseSearch.didSearch", { count: 7 })).toBe("Found 7 results")
	})

	it("uses the bare key for count 1 when a key has no _one form", () => {
		expect(i18next.t("chat:contextManagement.truncation.messagesRemoved", { count: 1 })).toBe("1 message removed")
		expect(i18next.t("chat:contextManagement.truncation.messagesRemoved", { count: 4 })).toBe("4 messages removed")
	})

	it("selects the Polish one/few/many/other forms Intl asks for", async () => {
		// Polish needs one (1), few (2-4, 22-24), many (0, 5-21, 25) and other (fractions).
		// A locale lacking the asked form falls back to English ("Found 2 results").
		await i18next.changeLanguage("pl")
		expect([1, 2, 5, 22, 0, 1.5].map((count) => i18next.t("chat:codebaseSearch.didSearch", { count }))).toEqual([
			"Znaleziono 1 wynik",
			"Znaleziono 2 wyniki",
			"Znaleziono 5 wyników",
			"Znaleziono 22 wyniki",
			"Znaleziono 0 wyników",
			"Znaleziono 1.5 wyniku",
		])
		expect([1, 3, 12].map((count) => i18next.t("history:subtasks", { count }))).toEqual([
			"1 podzadanie",
			"3 podzadania",
			"12 podzadań",
		])
	})

	it("falls back to English for a key a loaded locale lacks, and for an unknown language", async () => {
		i18next.addResource("fr", "chat", "__probe_only_en", "fr-only")
		i18next.addResource("en", "chat", "__probe_en", "english text")
		await i18next.changeLanguage("fr")
		expect(i18next.t("chat:__probe_en")).toBe("english text")
		expect(i18next.t("chat:__probe_only_en")).toBe("fr-only")

		await loadLanguage("xx")
		await i18next.changeLanguage("xx")
		expect(i18next.t("chat:codebaseSearch.didSearch", { count: 2 })).toBe("Found 2 results")
	})

	it("returns the key without its namespace for a missing key", () => {
		expect(i18next.t("chat:no.such.key")).toBe("no.such.key")
		expect(i18next.t("chat:no.such.key", { defaultValue: "fallback {{x}}", x: 1 })).toBe("fallback 1")
		expect(i18next.exists("chat:no.such.key")).toBe(false)
		expect(i18next.exists("chat:codebaseSearch.didSearch_one")).toBe(true)
	})

	it("re-renders useTranslation consumers on a language change", async () => {
		const { getByTestId, rerender } = render(<Probe count={3} />)
		expect(getByTestId("probe").textContent).toBe("Found 3 results")

		await i18next.changeLanguage("fr")
		rerender(<Probe count={1} />)
		expect(getByTestId("probe").textContent).toBe("1 résultat trouvé")
	})

	it("renders <Trans> with a component tag, a basic HTML tag and values", () => {
		const { container } = render(
			<div>
				<Trans
					i18nKey="chat:shellIntegration.description"
					components={{ settingsLink: <a href="#settings" /> }}
				/>
				<Trans
					i18nKey="errors.wait_checkpoint_long_time"
					ns="common"
					values={{ timeout: 30 }}
					components={{ settingsLink: <a href="#checkpoints" /> }}
				/>
			</div>,
		)
		expect(container.innerHTML).toBe(
			'<div>Your command is being executed without VSCode terminal shell integration. To suppress this warning you can disable shell integration in the <strong>Terminal</strong> section of the <a href="#settings">Tumble Code settings</a> or troubleshoot VSCode terminal integration using the link below.' +
				'Waited 30 seconds for checkpoint initialization. If you don\'t need the checkpoint feature, please turn it off in <a href="#checkpoints">the checkpoint settings</a>.</div>',
		)
	})
})
