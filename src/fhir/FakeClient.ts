/* eslint-disable @typescript-eslint/no-explicit-any,no-unused-vars */

export type Client = {
  request: <T = any>(path: string) => Promise<T>
  patient: { id: string }
  encounter: { id: string }
  fhirUser: string
  fhirUserType: string
}
