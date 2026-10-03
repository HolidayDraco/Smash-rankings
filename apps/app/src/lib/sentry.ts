/*
 * iOS/Android: error reporting is not set up yet, so these do nothing. The web build uses
 * sentry.web.ts instead. When the native apps ship, swap in @sentry/react-native here.
 */

export function initSentry(): void {}

export function reportRenderError(_error: unknown, _componentStack?: string): void {}
