import type { ReactElement } from 'react'

import { FlowError } from '#components/flow-error/FlowError'

type Props = {
    searchParams: Promise<{ error?: string; detail?: string }>
}

export default async function LaunchErrorPage({ searchParams }: Props): Promise<ReactElement> {
    const { error, detail } = await searchParams

    return <FlowError stage="launch" error={error ?? 'unknown_error'} detail={detail} />
}
