export type Severity = 'OK' | 'INFO' | 'WARNING' | 'ERROR'

export type Validation = {
  message: string
  severity: Severity
  hl7Ref?: string
  fhirRef?: string
  navRef?: string
}

export function validation(
  message: string,
  severity: Severity,
  refs?: {
    hl7?: string
    fhirRef?: string
    navRef?: string
  },
): Validation {
  return {
    message,
    severity,
    hl7Ref: refs?.hl7,
    fhirRef: refs?.fhirRef,
    navRef: refs?.navRef,
  }
}
