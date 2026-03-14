/** Errors from cryptographic operations. */
export class CryptoError extends Error {
  constructor(
    public readonly code:
      | "INVALID_KEY_LENGTH"
      | "INVALID_PUBLIC_KEY"
      | "SIGNATURE_INVALID"
      | "INVALID_SIGNATURE_ENCODING"
      | "SERIALIZATION_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "CryptoError";
  }

  static invalidKeyLength(got: number): CryptoError {
    return new CryptoError(
      "INVALID_KEY_LENGTH",
      `Invalid public key length: expected 32, got ${got}`,
    );
  }

  static invalidPublicKey(): CryptoError {
    return new CryptoError("INVALID_PUBLIC_KEY", "Invalid public key");
  }

  static signatureInvalid(): CryptoError {
    return new CryptoError(
      "SIGNATURE_INVALID",
      "Signature verification failed",
    );
  }

  static invalidSignatureEncoding(detail: string): CryptoError {
    return new CryptoError(
      "INVALID_SIGNATURE_ENCODING",
      `Invalid signature encoding: ${detail}`,
    );
  }

  static serializationError(detail: string): CryptoError {
    return new CryptoError(
      "SERIALIZATION_ERROR",
      `Serialization error: ${detail}`,
    );
  }
}
