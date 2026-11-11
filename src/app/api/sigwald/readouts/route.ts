import { NextRequest } from "next/server";

import { listReadouts } from "@/modules/readouts/routes";

export async function GET(request: NextRequest) {
  return listReadouts(request);
}
