// Country <option> data for phone dial codes and selects in auth forms.
// The list of allowed country codes is the shared contract
// (WAITLIST_COUNTRIES); these labels and dial codes are presentation only.

import { WAITLIST_COUNTRIES } from "@promptpaid/shared";

type CountryCode = (typeof WAITLIST_COUNTRIES)[number];

const LABELS: Record<CountryCode, string> = {
  NG: "Nigeria",
  ZA: "South Africa",
  GH: "Ghana",
  KE: "Kenya",
};

const DIALS: Record<CountryCode, string> = {
  NG: "+234",
  ZA: "+27",
  GH: "+233",
  KE: "+254",
};

export interface CountryOption {
  code: CountryCode;
  label: string;
  dial: string;
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = WAITLIST_COUNTRIES.map(
  (code) => ({ code, label: LABELS[code], dial: DIALS[code] }),
);
