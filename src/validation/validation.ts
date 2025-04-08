export type Severity = 'OK' | 'INFO' | 'WARNING' | 'ERROR'

export type Validation = {
  message: string
  severity: Severity
  fhirRef?: string
  navRef?: string
}

export function validation(
  message: string,
  severity: Severity,
  refs?: {
    fhirRef?: string
    navRef?: string
  },
): Validation {
  return {
    message,
    severity,
    fhirRef: refs?.fhirRef,
    navRef: refs?.navRef,
  }
}
