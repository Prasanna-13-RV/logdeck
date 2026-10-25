export const emvDictionaryVersion = '1.1.0'
export const emvDictionarySource = 'https://emvlab.org/emvtags/'

export interface EmvDefinition {
  tag: string
  name: string
  description: string
  bytes?: number
  sensitive?: boolean
}

// Original short summaries of common tag facts, not a copied tag database.
export const emvDictionary: readonly EmvDefinition[] = [
  { tag: '4F', name: 'Application Identifier (AID)', description: 'Identifies a payment application on the card.' },
  { tag: '50', name: 'Application Label', description: 'Card-provided short application label.' },
  { tag: '57', name: 'Track 2 Equivalent Data', description: 'Chip representation of track 2 payment data. Treat as sensitive.', sensitive: true },
  { tag: '5A', name: 'Application PAN', description: 'Primary account number associated with the application. Treat as sensitive.', sensitive: true },
  { tag: '5F20', name: 'Cardholder Name', description: 'Card-provided cardholder name. Treat as personal data.', sensitive: true },
  { tag: '5F24', name: 'Application Expiration Date', description: 'Application expiry date encoded as YYMMDD.', bytes: 3 },
  { tag: '5F25', name: 'Application Effective Date', description: 'Application start date encoded as YYMMDD.', bytes: 3 },
  { tag: '5F28', name: 'Issuer Country Code', description: 'Numeric country code associated with the issuer.', bytes: 2 },
  { tag: '5F2A', name: 'Transaction Currency Code', description: 'Numeric currency code for the transaction amount.', bytes: 2 },
  { tag: '5F30', name: 'Service Code', description: 'Service restrictions associated with the card application.', bytes: 2 },
  { tag: '5F34', name: 'PAN Sequence Number', description: 'Distinguishes cards sharing the same account number.', bytes: 1 },
  { tag: '61', name: 'Application Template', description: 'Constructed directory entry describing an application.' },
  { tag: '6F', name: 'File Control Information Template', description: 'Constructed response template containing selected-file information.' },
  { tag: '70', name: 'Record Template', description: 'Constructed container for application record data.' },
  { tag: '71', name: 'Issuer Script Template 1', description: 'Issuer commands intended for processing before the final GENERATE AC.' },
  { tag: '72', name: 'Issuer Script Template 2', description: 'Issuer commands intended for processing after the final GENERATE AC.' },
  { tag: '77', name: 'Response Message Template Format 2', description: 'Constructed response carrying individually tagged data objects.' },
  { tag: '80', name: 'Response Message Template Format 1', description: 'Response whose value uses command-specific positional fields, not nested TLVs.' },
  { tag: '82', name: 'Application Interchange Profile (AIP)', description: 'Card application capability flags. Some bits depend on kernel/version.', bytes: 2 },
  { tag: '84', name: 'Dedicated File Name', description: 'Identifies a selected dedicated file, commonly an application AID.' },
  { tag: '87', name: 'Application Priority Indicator', description: 'Application selection priority and confirmation indication.', bytes: 1 },
  { tag: '88', name: 'Short File Identifier', description: 'Short identifier used to address a card file.', bytes: 1 },
  { tag: '8A', name: 'Authorisation Response Code', description: 'Response code supplied for transaction authorisation.', bytes: 2 },
  { tag: '8C', name: 'Card Risk Management DOL 1 (CDOL1)', description: 'Tag/length requests for the first GENERATE AC; a DOL is not a value-bearing TLV sequence.' },
  { tag: '8D', name: 'Card Risk Management DOL 2 (CDOL2)', description: 'Tag/length requests for a subsequent GENERATE AC; values are supplied separately.' },
  { tag: '8E', name: 'Cardholder Verification Method List', description: 'Amount thresholds and ordered cardholder-verification rules.' },
  { tag: '8F', name: 'CA Public Key Index', description: 'Selects the certification-authority public key used for authentication.', bytes: 1 },
  { tag: '91', name: 'Issuer Authentication Data', description: 'Issuer-supplied authentication material; interpretation depends on the application.' },
  { tag: '94', name: 'Application File Locator (AFL)', description: 'Record ranges to read, including offline-authentication participation.' },
  { tag: '95', name: 'Terminal Verification Results (TVR)', description: 'Terminal status flags recording authentication, verification and risk-management outcomes.', bytes: 5 },
  { tag: '9A', name: 'Transaction Date', description: 'Local transaction date encoded as YYMMDD.', bytes: 3 },
  { tag: '9B', name: 'Transaction Status Information (TSI)', description: 'Flags indicating which transaction processing functions were performed.', bytes: 2 },
  { tag: '9C', name: 'Transaction Type', description: 'Numeric code identifying the transaction category.', bytes: 1 },
  { tag: '9F01', name: 'Acquirer Identifier', description: 'Numeric identifier for the acquiring institution.', bytes: 6 },
  { tag: '9F02', name: 'Amount, Authorised (Numeric)', description: 'Main transaction amount in packed numeric form; currency exponent is separate.', bytes: 6 },
  { tag: '9F03', name: 'Amount, Other (Numeric)', description: 'Additional transaction amount, such as cashback, in packed numeric form.', bytes: 6 },
  { tag: '9F06', name: 'Terminal Application Identifier', description: 'AID configured at the terminal for application selection.' },
  { tag: '9F07', name: 'Application Usage Control', description: 'Issuer-defined restrictions on permitted services and locations.', bytes: 2 },
  { tag: '9F09', name: 'Terminal Application Version Number', description: 'Application version configured at the terminal.', bytes: 2 },
  { tag: '9F10', name: 'Issuer Application Data', description: 'Issuer/application-specific data; no universal semantic decoder is assumed.' },
  { tag: '9F12', name: 'Application Preferred Name', description: 'Preferred application name supplied for cardholder display.' },
  { tag: '9F13', name: 'Last Online Application Transaction Counter', description: 'ATC recorded for the most recent online transaction, as maintained by the card.', bytes: 2 },
  { tag: '9F17', name: 'PIN Try Counter', description: 'Remaining PIN verification attempts reported by the card.', bytes: 1 },
  { tag: '9F1A', name: 'Terminal Country Code', description: 'Numeric country code configured at the terminal.', bytes: 2 },
  { tag: '9F1E', name: 'Interface Device Serial Number', description: 'Identifier of the device interface used for the transaction.', bytes: 8 },
  { tag: '9F26', name: 'Application Cryptogram', description: 'Card-generated cryptogram authenticating selected transaction data.', bytes: 8 },
  { tag: '9F27', name: 'Cryptogram Information Data', description: 'Indicates the cryptogram type and associated flags.', bytes: 1 },
  { tag: '9F33', name: 'Terminal Capabilities', description: 'Input, cardholder-verification and security capabilities of the terminal.', bytes: 3 },
  { tag: '9F34', name: 'Cardholder Verification Method Results', description: 'CVM method, condition and result recorded by the terminal.', bytes: 3 },
  { tag: '9F35', name: 'Terminal Type', description: 'Terminal environment, control and communication classification.', bytes: 1 },
  { tag: '9F36', name: 'Application Transaction Counter (ATC)', description: 'Card-maintained transaction counter.', bytes: 2 },
  { tag: '9F37', name: 'Unpredictable Number', description: 'Terminal-generated challenge contributing transaction freshness.', bytes: 4 },
  { tag: '9F38', name: 'Processing Options DOL (PDOL)', description: 'Tag/length requests for GET PROCESSING OPTIONS; not nested value-bearing TLVs.' },
  { tag: '9F40', name: 'Additional Terminal Capabilities', description: 'Additional transaction and input/output capability flags.', bytes: 5 },
  { tag: '9F41', name: 'Transaction Sequence Counter', description: 'Terminal-maintained transaction sequence value.' },
  { tag: '9F66', name: 'Terminal Transaction Qualifiers (Visa TTQ)', description: 'Visa contactless terminal qualifiers. Do not apply the Visa layout to other kernels.', bytes: 4 },
  { tag: '9F6C', name: 'Card Transaction Qualifiers (Visa CTQ)', description: 'Visa contactless card qualifiers. Scheme/profile must be selected explicitly.', bytes: 2 },
  { tag: '9F6E', name: 'Scheme-specific Data', description: 'Meaning and layout depend on scheme, kernel and version. Raw-only until the applicable profile is verified.' },
  { tag: 'A5', name: 'FCI Proprietary Template', description: 'Constructed container for application-specific file control information.' },
  { tag: 'BF0C', name: 'FCI Issuer Discretionary Data', description: 'Constructed container for issuer-defined file control information.' }
]

const byTag = new Map(emvDictionary.map(definition => [definition.tag, definition]))
export function emvDefinition(tag: string) { return byTag.get(tag.replace(/\s/g, '').toUpperCase()) }
