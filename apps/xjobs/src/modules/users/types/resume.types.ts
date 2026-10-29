export type ResumeMeta = {
  key: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
};

/** The parts of a multer upload the resume flow reads. */
export type UploadedPdf = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};
