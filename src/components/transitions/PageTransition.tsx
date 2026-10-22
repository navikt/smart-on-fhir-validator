import { ViewTransition, type ReactNode } from 'react'

export function PageTransition({ children }: { children: ReactNode }): ReactNode {
    return (
        <ViewTransition default="none" enter="fade-in" exit="fade-out">
            {children}
        </ViewTransition>
    )
}
