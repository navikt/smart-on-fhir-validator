import { describe, expect, it } from 'vitest'

import {
    buildAudEnforcementFinding,
    evaluateAudEnforcementResponse,
    type AudEnforcementContext,
} from './aud-enforcement'

const CONTEXT: AudEnforcementContext = {
    requestUrl: 'https://ehr.example.com/auth/authorize',
    redirectUri: 'https://validator.nav.no/callback',
}

describe('evaluateAudEnforcementResponse — rejected', () => {
    it('is rejected when the server redirects back with an OAuth `error`', () => {
        const verdict = evaluateAudEnforcementResponse(
            {
                status: 302,
                location: 'https://validator.nav.no/callback?error=invalid_request&state=abc',
            },
            CONTEXT,
        )

        expect(verdict).toEqual({ kind: 'rejected' })
    })

    it('is rejected on a direct 4xx with no redirect at all', () => {
        const verdict = evaluateAudEnforcementResponse({ status: 400, location: null }, CONTEXT)

        expect(verdict).toEqual({ kind: 'rejected' })
    })

    it('resolves a relative `Location` against the request URL before classifying it', () => {
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: '/callback?error=invalid_request' },
            {
                requestUrl: 'https://validator.nav.no/auth/authorize',
                redirectUri: 'https://validator.nav.no/callback',
            },
        )

        expect(verdict).toEqual({ kind: 'rejected' })
    })
})

describe('evaluateAudEnforcementResponse — not-rejected (the security finding)', () => {
    it('is not-rejected when the server redirects back with a `code` despite the wrong aud', () => {
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: 'https://validator.nav.no/callback?code=abc123&state=xyz' },
            CONTEXT,
        )

        expect(verdict).toEqual({ kind: 'not-rejected' })
    })
})

describe('evaluateAudEnforcementResponse — inconclusive', () => {
    it('is inconclusive on a transport failure (status 0)', () => {
        const verdict = evaluateAudEnforcementResponse({ status: 0, location: null }, CONTEXT)

        expect(verdict.kind).toBe('inconclusive')
    })

    it('is inconclusive on a 3xx with no Location header', () => {
        const verdict = evaluateAudEnforcementResponse({ status: 302, location: null }, CONTEXT)

        expect(verdict).toEqual({
            kind: 'inconclusive',
            reason: 'The authorization endpoint responded with HTTP 302 but no `Location` header.',
        })
    })

    it('is inconclusive when the Location header cannot be resolved to a URL at all', () => {
        // A relative `Location` needs a valid absolute base to resolve against, so an invalid
        // `requestUrl` is the only way to exercise the genuinely-unparseable branch.
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: 'https://validator.nav.no/callback?error=invalid_request' },
            { requestUrl: 'not-a-valid-base-url', redirectUri: CONTEXT.redirectUri },
        )

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('could not be parsed as a URL')
    })

    it("is inconclusive when this app's own registered redirect_uri is itself unparseable", () => {
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: 'https://ehr.example.com/login?session=1' },
            { requestUrl: CONTEXT.requestUrl, redirectUri: 'not-a-valid-redirect-uri' },
        )

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('redirected somewhere other than')
    })

    it("is inconclusive when the redirect target is not this app's own redirect_uri", () => {
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: 'https://ehr.example.com/login?session=1' },
            CONTEXT,
        )

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('redirected somewhere other than')
    })

    it('is inconclusive when the redirect back has neither `error` nor `code`', () => {
        const verdict = evaluateAudEnforcementResponse(
            { status: 302, location: 'https://validator.nav.no/callback?state=xyz' },
            CONTEXT,
        )

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('without either an `error` or a `code`')
    })

    it('is inconclusive on a 2xx, e.g. an interactive login/consent page', () => {
        const verdict = evaluateAudEnforcementResponse({ status: 200, location: null }, CONTEXT)

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('interactive login/consent page')
    })

    it('is inconclusive on an unexpected status code, e.g. a server error', () => {
        const verdict = evaluateAudEnforcementResponse({ status: 500, location: null }, CONTEXT)

        expect(verdict.kind).toBe('inconclusive')
        if (verdict.kind !== 'inconclusive') return
        expect(verdict.reason).toContain('unexpected HTTP status 500')
    })
})

describe('buildAudEnforcementFinding', () => {
    it('reports `rejected` as an OK finding', () => {
        const finding = buildAudEnforcementFinding({ kind: 'rejected' })

        expect(finding.severity).toBe('OK')
        expect(finding.message).toContain('rejected an authorization request')
    })

    it('reports `not-rejected` as an ERROR finding naming the confused-deputy risk', () => {
        const finding = buildAudEnforcementFinding({ kind: 'not-rejected' })

        expect(finding.severity).toBe('ERROR')
        expect(finding.message).toContain('did NOT reject')
        expect(finding.message).toContain('confused-deputy attack')
    })
})
