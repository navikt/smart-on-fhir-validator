import React from 'react'

export interface UploadBinaryProps {
  // eslint-disable-next-line no-unused-vars
  mutate: (file: File) => void
}

export default function UploadBinary({ mutate }: UploadBinaryProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return

    const file = event.target.files[0]
    mutate(file)
  }

  return (
    <div>
      <input type="file" onChange={handleFileChange} />
      <p>Select a file to upload it to the FHIR server.</p>
    </div>
  )
}
