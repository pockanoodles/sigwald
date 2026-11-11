/**
 * Nager.Date's holidays for a country and year.
 * Docs: https://date.nager.at/Api (GET /api/v3/PublicHolidays/{year}/{countryCode})
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError, isConnectorError } from "@/lib/connectors/errors";

export interface NagerHoliday {
  /** YYYY-MM-DD */
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  /** Observed nationwide; otherwise only in `counties`. */
  global: boolean;
  counties: string[] | null;
  types: string[];
}

export async function publicHolidays(
  http: Http,
  year: number,
  country: string
): Promise<NagerHoliday[]> {
  try {
    return await http.json<NagerHoliday[]>(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(country)}`
    );
  } catch (error) {
    if (isConnectorError(error) && error.kind === "not_found") {
      throw new ConnectorError(
        "config",
        `Nager.Date has no holidays for ${country}: check its two-letter code.`
      );
    }
    throw error;
  }
}
