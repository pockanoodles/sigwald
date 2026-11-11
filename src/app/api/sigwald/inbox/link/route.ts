import { NextRequest } from "next/server";

import { deleteLink, getLink, makeLink } from "@/modules/inbox/routes";

export async function GET(request: NextRequest) {
  return getLink(request);
}

export async function POST(request: NextRequest) {
  return makeLink(request);
}

export async function DELETE(request: NextRequest) {
  return deleteLink(request);
}
