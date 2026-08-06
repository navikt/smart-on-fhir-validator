import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { JsonBlock } from './JsonBlock'

describe('JsonBlock', () => {
    it('pretty-prints a normal object as JSON inside a scrollable, keyboard-focusable <pre>', () => {
        const html = renderToStaticMarkup(<JsonBlock value={{ resourceType: 'Patient', id: '123' }} />)

        expect(html).toContain('role="code"')
        expect(html).toContain('tabindex="0"')
        expect(html).toContain('&quot;resourceType&quot;: &quot;Patient&quot;')
        expect(html).toContain('&quot;id&quot;: &quot;123&quot;')
    })

    it('renders a raw non-JSON string body verbatim, not as a quoted JSON literal', () => {
        const html = renderToStaticMarkup(<JsonBlock value="not json at all" />)

        expect(html).toContain('not json at all')
        expect(html).not.toContain('&quot;not json at all&quot;')
    })

    it('renders null as the literal text "null"', () => {
        const html = renderToStaticMarkup(<JsonBlock value={null} />)

        expect(html).toMatch(/<pre[^>]*>null<\/pre>/)
    })

    it('renders undefined as the literal text "null"', () => {
        const html = renderToStaticMarkup(<JsonBlock value={undefined} />)

        expect(html).toMatch(/<pre[^>]*>null<\/pre>/)
    })

    it('ships no <script> or inline style="" attributes for its own markup', () => {
        const html = renderToStaticMarkup(<JsonBlock value={{ a: 1 }} />)

        expect(html).not.toContain('<script')
        expect(html).not.toContain('style="')
    })
})
