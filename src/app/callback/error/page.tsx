import type { ReactElement } from 'react'

import { FlowError } from '#components/flow-error/FlowError'

type Props = {
    searchParams: Promise<{ error?: string; detail?: string }>
}

export default async function CallbackErrorPage({ searchParams }: Props): Promise<ReactElement> {
    const { error, detail } = await searchParams

    return <FlowError stage="callback" error={error ?? 'unknown_error'} detail={detail} />
}
