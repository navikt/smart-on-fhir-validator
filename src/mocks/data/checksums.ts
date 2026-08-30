/**
 * Modulus-11 check digits for the Norwegian identifiers used across the synthetic data set.
 * Real algorithms applied to invented base digits (never real personal data) so the generated
 * identifiers pass the same validation an EHR vendor's own system would apply.
 *
 * @see https://www.skatteetaten.no/person/folkeregister/fodsel-og-navnevalg/barn-fodt-i-norge/fodselsnummer/
 */

const FNR_WEIGHTS_1 = [3, 7, 6, 1, 8, 9, 4, 5, 2]
const FNR_WEIGHTS_2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const ORGNR_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2]

function weightedCheckDigit(digits: readonly number[], weights: readonly number[]): number | null {
    const sum = digits.reduce((acc, digit, i) => acc + digit * (weights[i] ?? 0), 0)
    const check = 11 - (sum % 11)
    if (check === 11) return 0
    if (check === 10) return null // no valid check digit for this base: caller must pick another

    return check
}

/**
 * `ddMMyy` plus a 3-digit individual number, e.g. `010190` + `501`. For a synthetic D-number,
 * add 40 to the day-of-month before calling (e.g. `41` instead of `01`).
 */
export function fodselsnummer(ddMMyy: string, individualNumber: string): string {
    const base = `${ddMMyy}${individualNumber}`.split('').map(Number)
    const k1 = weightedCheckDigit(base, FNR_WEIGHTS_1)
    if (k1 === null) throw new Error(`No valid fødselsnummer check digit for base "${base.join('')}"`)

    const k2 = weightedCheckDigit([...base, k1], FNR_WEIGHTS_2)
    if (k2 === null) throw new Error(`No valid fødselsnummer check digit for base "${base.join('')}"`)

    return `${base.join('')}${k1}${k2}`
}

/** An 8-digit base plus its modulus-11 check digit, e.g. Brønnøysundregistrene organisasjonsnummer. */
export function organisasjonsnummer(base8: string): string {
    const base = base8.split('').map(Number)
    const check = weightedCheckDigit(base, ORGNR_WEIGHTS)
    if (check === null) throw new Error(`No valid organisasjonsnummer check digit for base "${base8}"`)

    return `${base8}${check}`
}
