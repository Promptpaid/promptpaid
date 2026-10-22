import { ENV } from "@/env.server";
import { PAYMENT_PROVIDERS } from "@promptpaid/shared";
import { FakePaymentProvider } from "./fake";
import type { PaymentProviderAdapter } from "./types";

export type { PaymentProviderAdapter } from "./types";
export {
    FAKE_SIGNATURE_HEADER,
    fakeSignatureFor,
    recordSimulatedTransaction,
} from "./fake";

let activeProvider: PaymentProviderAdapter | null = null;

function configuredProviderName(): string {
    const name = ENV.PAYMENT_PROVIDER?.trim();
    return name && name.length > 0 ? name : "fake";
}

/**
 * The one way every consumer gets its adapter. Refuses unknown provider
 * names and refuses the fake provider outside development (defense in
 * depth: the fake's constructor throws too, and the server boot calls this
 * before listening).
 */
export function paymentProvider(): PaymentProviderAdapter {
    if (activeProvider) return activeProvider;

    const name = configuredProviderName();
    if (!(PAYMENT_PROVIDERS as readonly string[]).includes(name)) {
        throw new Error(`Payments: unknown provider "${name}".`);
    }
    if (name === "fake" && ENV.NODE_ENV !== "development") {
        throw new Error("Payments: the fake provider is development-only.");
    }
    activeProvider = new FakePaymentProvider();
    return activeProvider;
}

/**
 * Called at server boot so a bad provider configuration fails loudly before
 * the server accepts any traffic.
 */
export function initPaymentsProvider(): void {
    const provider = paymentProvider();
    console.log(`payments: provider=${provider.name}`);
}
