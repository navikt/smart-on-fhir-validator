'use client'

import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import type { DebugSessionView } from '#core/debug/session-view'

import { JsonBlock } from '#components/json/JsonBlock'

import { EYEBROW_CLASSES } from './styles'

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
    return (
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="text-14 w-32 shrink-0 font-semibold text-ax-text-neutral-subtle">{label}</dt>
            <dd className="text-14 font-mono break-all">{children}</dd>
        </div>
    )
}

const subscribeNever = (): (() => void) => () => undefined

const NOT_RETURNED = <span className="font-sans text-ax-text-neutral-subtle italic">Not returned</span>

export function TokenPanel({ session }: { session: DebugSessionView }): ReactElement {
    const now = useSyncExternalStore(subscribeNever, Date.now, () => null)

    const expiry = Date.parse(session.expiresAt)
    const expired = now !== null && Number.isFinite(expiry) && now >= expiry
    const scopes = session.grantedScope.split(/\s+/).filter((scope) => scope !== '')

    return (
        <details className="rounded border border-ax-border-neutral-subtle bg-white px-5 py-[18px]">
            <summary className={`${EYEBROW_CLASSES} min-h-11 cursor-pointer`}>Launch token</summary>
            <div className="mt-3 flex flex-col gap-4">
                <p className="text-14 max-w-[70ch] text-ax-text-neutral-subtle">
                    The access, refresh and ID tokens stay on the server and are never shown here.
                </p>
                <dl className="flex flex-col gap-2">
                    <Row label="Patient">{session.patient ?? NOT_RETURNED}</Row>
                    <Row label="Encounter">{session.encounter ?? NOT_RETURNED}</Row>
                    <Row label="fhirUser">{session.fhirUser ?? NOT_RETURNED}</Row>
                    <Row label="Expires at">
                        {session.expiresAt}
                        {expired && (
                            <span className="text-13 ml-2 rounded bg-ax-bg-danger-soft px-2 py-0.5 font-sans font-semibold text-ax-text-danger">
                                Expired
                            </span>
                        )}
                    </Row>
                </dl>

                <div className="flex flex-col gap-2">
                    <h3 className="text-14 font-semibold text-ax-text-neutral-subtle">Granted scopes</h3>
                    {scopes.length === 0 ? (
                        <p className="text-14 text-ax-text-neutral-subtle italic">None returned</p>
                    ) : (
                        <ul className="flex flex-wrap gap-2">
                            {scopes.map((scope) => (
                                <li
                                    key={scope}
                                    className="text-13 rounded border border-ax-border-neutral-subtle px-2 py-0.5 font-mono"
                                >
                                    {scope}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <h3 className="text-14 font-semibold text-ax-text-neutral-subtle">ID token claims</h3>
                    {session.idTokenClaims === null ? (
                        <p className="text-14 text-ax-text-neutral-subtle italic">
                            No ID token was returned.
                        </p>
                    ) : (
                        <JsonBlock value={session.idTokenClaims} />
                    )}
                </div>
            </div>
        </details>
    )
}
