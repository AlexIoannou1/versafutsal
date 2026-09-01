/**
 * Account phone metadata and normalization shared by the API boundary and
 * the Expo phone control. User phones are stored and returned as E.164.
 *
 * This intentionally covers the countries offered by the account control
 * rather than guessing at arbitrary country formats.
 */
export const PHONE_COUNTRIES = [
  { code: "CY", dialCode: "357", name: "Cyprus", nationalDigits: 8 },
  { code: "GR", dialCode: "30", name: "Greece", nationalDigits: 10 },
  { code: "GB", dialCode: "44", name: "United Kingdom", nationalDigits: 10 },
  { code: "US", dialCode: "1", name: "United States", nationalDigits: 10 },
  { code: "CA", dialCode: "1", name: "Canada", nationalDigits: 10 },
  { code: "AU", dialCode: "61", name: "Australia", nationalDigits: 9 },
  { code: "DE", dialCode: "49", name: "Germany", nationalDigits: 10 },
  { code: "FR", dialCode: "33", name: "France", nationalDigits: 9 },
  { code: "IT", dialCode: "39", name: "Italy", nationalDigits: 10 },
  { code: "ES", dialCode: "34", name: "Spain", nationalDigits: 9 },
] as const;

export type PhoneCountryCode = (typeof PHONE_COUNTRIES)[number]["code"];
export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = "CY";

function countryForCode(code: PhoneCountryCode) {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? PHONE_COUNTRIES[0];
}

function countryForDialCode(digits: string) {
  return [...PHONE_COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((country) => digits.startsWith(country.dialCode));
}

function digitsFromInput(value: string): string {
  const trimmed = value.normalize("NFC").trim();
  if (!trimmed) throw new Error("Phone number is required");
  if (!/^(?:\+|00)?[0-9][0-9 ()-]*$/.test(trimmed)) {
    throw new Error("Phone number must contain digits only");
  }
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    throw new Error("Phone number is invalid");
  }
  if (trimmed.startsWith("+")) {
    return `INTL:${digits}`;
  }
  if (trimmed.startsWith("00")) {
    return `INTL:${digits.slice(2)}`;
  }
  return `LOCAL:${digits}`;
}

export function getPhoneCountry(code: PhoneCountryCode) {
  return countryForCode(code);
}

export function getPhoneCountryForE164(value: string): PhoneCountryCode {
  const digits = value.replace(/^\+/, "");
  return countryForDialCode(digits)?.code ?? DEFAULT_PHONE_COUNTRY;
}

export function isValidNationalPhoneNumber(
  countryCode: PhoneCountryCode,
  nationalNumber: string,
): boolean {
  const country = countryForCode(countryCode);
  return new RegExp(`^[1-9][0-9]{${country.nationalDigits - 1}}$`).test(nationalNumber);
}

export function normalizePhoneNumber(
  value: string,
  defaultCountry: PhoneCountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  const parsed = digitsFromInput(value);
  let country = countryForCode(defaultCountry);
  let nationalNumber: string;

  if (parsed.startsWith("LOCAL:")) {
    nationalNumber = parsed.slice("LOCAL:".length);
  } else {
    const internationalCountry = countryForDialCode(parsed.slice("INTL:".length));
    if (!internationalCountry) throw new Error("Phone country code is not supported");
    country = internationalCountry;
    nationalNumber = parsed.slice("INTL:".length + country.dialCode.length);
  }

  if (!isValidNationalPhoneNumber(country.code, nationalNumber)) {
    throw new Error(`Phone number must contain ${country.nationalDigits} national digits`);
  }

  const result = `+${country.dialCode}${nationalNumber}`;
  if (result.length < 8 || result.length > 16) throw new Error("Phone number is invalid");
  return result;
}

export function nationalNumberFromE164(value: string): string {
  const digits = value.replace(/^\+/, "");
  const country = countryForDialCode(digits);
  return country ? digits.slice(country.dialCode.length) : digits;
}