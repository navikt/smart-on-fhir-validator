export type Severity = 'OK' | 'INFO' | 'WARNING' | 'ERROR'

export class Validation {
  message: string
  severity: Severity

  constructor(message: string, severity: Severity) {
    this.message = message
    this.severity = severity
  }
}
