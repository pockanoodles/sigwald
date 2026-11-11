import { NextRequest } from "next/server";

import { getStatusReadings } from "@/modules/connect/routes";

export async function GET(request: NextRequest) {
  return getStatusReadings(request);
}
