import type { z } from "zod"

/**
 * Maps each discriminator value of a discriminated union to the option that
 * accepts it. Zod 3 exposed this as `optionsMap`; zod 4 keeps the values each
 * option accepts in `_zod.propValues`, keyed by property name. An option whose
 * discriminator is an enum appears once per enum value.
 */
export function discriminatorMap<Option extends z.ZodObject>(
	union: z.ZodDiscriminatedUnion<readonly Option[]>,
	discriminator: string,
): Map<unknown, Option> {
	const map = new Map<unknown, Option>()
	for (const option of union.options) {
		const values = option._zod.propValues?.[discriminator]
		if (!values) throw new Error(`Option without a "${discriminator}" discriminator`)
		for (const value of values) map.set(value, option)
	}
	return map
}
