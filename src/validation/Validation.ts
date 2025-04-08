export type Severity = 'OK' | 'INFO' | 'WARNING' | 'ERROR'

export type Validation = {
  message: string
  severity: Severity
  fhirRef?: string
  navRef?: string
}

export function validation(message: string, severity: Severity): Validation {
  return {
    message,
    severity,
  }
}
