import type { ServiceManifest } from "@/lib/connectors/types";

export const STRIPE: ServiceManifest = {
  id: "stripe",
  name: "Stripe",
  homepage: "https://stripe.com",
  tokenHelp: {
    text: "Make a restricted key with Read access to Balance, Balance transactions, Disputes and Subscriptions, and None for everything else. Sigwald won't take a full secret key.",
    url: "https://dashboard.stripe.com/apikeys/create",
  },
  fields: [
    {
      key: "key",
      label: "Restricted key",
      kind: "secret",
      placeholder: "rk_live_…",
      pattern: {
        source: "rk_(live|test)_[A-Za-z0-9]{20,}",
        message: "Use a restricted key: it starts with rk_live_ or rk_test_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.stripe.com"] },
  egress: {
    to: "Stripe (api.stripe.com)",
    sends:
      "Your restricted key, with requests for your balance, disputes, active subscriptions and the last 30 days of charges",
    why: "To show your balance, recurring revenue and volume, and to make a task for each dispute that needs an answer before its deadline. Nothing is written back.",
  },
};
