// Area code -> Telnyx phone number mapping for local presence dialing
// Add more numbers as they are purchased
const AREA_CODE_MAP: Record<string, string> = {
  "469": "+14694590748", // Dallas
  "214": "+14694590748", // Dallas
  "972": "+14694590748", // Dallas
  "817": "+14694590748", // Fort Worth
};

const DEFAULT_NUMBER = process.env.TELNYX_PHONE_NUMBER || "+14694590748";

export function getLocalNumber(prospectPhone: string): string {
  // Strip non-digit characters
  const digits = prospectPhone.replace(/\D/g, "");

  // Extract area code: handle +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX
  let areaCode: string;
  if (digits.length === 11 && digits.startsWith("1")) {
    areaCode = digits.substring(1, 4);
  } else if (digits.length === 10) {
    areaCode = digits.substring(0, 3);
  } else if (digits.length > 11 && digits.startsWith("1")) {
    areaCode = digits.substring(1, 4);
  } else {
    return DEFAULT_NUMBER;
  }

  return AREA_CODE_MAP[areaCode] || DEFAULT_NUMBER;
}
