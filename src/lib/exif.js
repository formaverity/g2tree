import ExifReader from 'exifreader'

export async function parseExif(file) {
  try {
    const buffer = await file.arrayBuffer()
    const tags = ExifReader.load(buffer, { expanded: true })

    const gps = tags.gps
    const exif = tags.exif
    const image = tags.image

    return {
      gps: gps
        ? {
            lat: gps.Latitude ?? null,
            lng: gps.Longitude ?? null,
            altitude: gps.Altitude ?? null,
          }
        : null,
      datetime:
        exif?.DateTimeOriginal?.description ??
        image?.DateTime?.description ??
        null,
      camera: {
        make: image?.Make?.description ?? null,
        model: image?.Model?.description ?? null,
      },
      dimensions: {
        width: image?.ImageWidth?.value ?? null,
        height: image?.ImageHeight?.value ?? null,
      },
    }
  } catch {
    return null
  }
}
