// The product's display name.
//
// It shipped with the owner's first name compiled into
// the page title, the Open Graph tag and the sign-in header, so the app could
// not be shown to anyone else without a code change (P0 remediation,
// 2026-09-05).
//
// Configurable rather than merely renamed: the default is generic, and a
// deployment can set VITE_PRODUCT_NAME to whatever it wants. Read from the
// build environment rather than the database because these strings are needed
// for document metadata before any user session exists.
export const PRODUCT_NAME: string = import.meta.env.VITE_PRODUCT_NAME || "Investment Companion";
