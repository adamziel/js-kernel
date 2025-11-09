declare const processController: any

const utilsModuleUrl = new URL(
	'../../runtime/busybox/lib/utils.ts',
	import.meta.url
).href
const fflateModuleUrl = new URL(
	'../../node_modules/fflate/esm/browser.js',
	import.meta.url
).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
		fflateModuleUrl: string
	}) {
		const {
			errorToString,
			exitSafely,
			getArgv,
			writeStderr,
			writeStdout,
		} = await import(/* @vite-ignore */ urls.utilsModuleUrl)

		let gunzipSync: ((input: Uint8Array) => Uint8Array) | null = null
		try {
			const fflateModule = await import(
				/* @vite-ignore */ urls.fflateModuleUrl
			)
			if (typeof fflateModule.gunzipSync !== 'function') {
				throw new Error('gunzipSync export is missing')
			}
			gunzipSync = fflateModule.gunzipSync as (
				input: Uint8Array
			) => Uint8Array
		} catch (error) {
			writeStderr(
				`extract-tar: unable to load gzip support: ${errorToString(
					error
				)}`
			)
			exitSafely(1)
			return
		}

		const argv = getArgv()
		let verbose = false
		let forceGunzip = false
		let baseDirectory: string | null = processController.cwd() !== '.' ? processController.cwd() : null
		let archivePath: string | null = null
		let expectDirectoryOperand = false
		let expectArchiveOperand = false

		for (let index = 0; index < argv.length; index += 1) {
			const arg = argv[index]

			if (expectDirectoryOperand) {
				baseDirectory = String(arg)
				expectDirectoryOperand = false
				continue
			}

			if (expectArchiveOperand) {
				archivePath = String(arg)
				expectArchiveOperand = false
				continue
			}

			if (arg === '-C') {
				expectDirectoryOperand = true
				continue
			}

			if (arg === '--') {
				if (index + 1 < argv.length) {
					archivePath = String(argv[index + 1])
				}
				break
			}

			if (arg.startsWith('-') && arg.length > 1) {
				const flags = arg.slice(1)
				for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
					const flag = flags[flagIndex]
					if (flag === 'x') {
						continue
					}
					if (flag === 'z') {
						forceGunzip = true
						continue
					}
					if (flag === 'v') {
						verbose = true
						continue
					}
					if (flag === 'f') {
						if (flagIndex < flags.length - 1) {
							archivePath = flags.slice(flagIndex + 1)
							break
						}
						expectArchiveOperand = true
						continue
					}

					writeStderr(`extract-tar: unsupported option -${flag}`)
					exitSafely(1)
					return
				}
				continue
			}

			if (!archivePath) {
				archivePath = String(arg)
				continue
			}

			writeStderr(`extract-tar: unexpected operand ${arg}`)
			exitSafely(1)
			return
		}

		if (expectDirectoryOperand || expectArchiveOperand) {
			writeStderr('extract-tar: option requires an argument')
			exitSafely(1)
			return
		}

		if (!archivePath) {
			writeStderr('extract-tar: missing archive operand')
			writeStderr('usage: extract-tar [-xzvf] [-C dir] <archive>')
			exitSafely(1)
			return
		}

		const fs = processController.fsSync

		const toUint8Array = (input: unknown): Uint8Array => {
			if (input instanceof Uint8Array) {
				return input
			}
			if (input instanceof ArrayBuffer) {
				return new Uint8Array(input)
			}
			if (
				input &&
				typeof input === 'object' &&
				'buffer' in input &&
				(input as { buffer: unknown }).buffer instanceof ArrayBuffer
			) {
				const view = input as {
					buffer: ArrayBuffer
					byteOffset?: number
					byteLength?: number
				}
				const byteOffset =
					typeof view.byteOffset === 'number' ? view.byteOffset : 0
				if (typeof view.byteLength === 'number') {
					return new Uint8Array(view.buffer, byteOffset, view.byteLength)
				}
				return new Uint8Array(view.buffer, byteOffset)
			}
			if (typeof input === 'string') {
				return new TextEncoder().encode(input)
			}
			return new Uint8Array(0)
		}

		let archiveBytes: Uint8Array
		try {
			const data = fs.readFileSync(archivePath)
			archiveBytes = toUint8Array(data)
		} catch (error) {
			writeStderr(
				`extract-tar: unable to read ${archivePath}: ${errorToString(
					error
				)}`
			)
			exitSafely(1)
			return
		}

		const isLikelyGzip =
			/\.t(?:ar\.)?gz$/i.test(archivePath) || /\.tgz$/i.test(archivePath)
		const shouldGunzip = forceGunzip || isLikelyGzip

		let tarBytes = archiveBytes
		if (shouldGunzip) {
			try {
				tarBytes = gunzipSync!(archiveBytes)
			} catch (error) {
				writeStderr(
					`extract-tar: failed to decompress ${archivePath}: ${errorToString(
						error
					)}`
				)
				exitSafely(1)
				return
			}
		}

		const blockSize = 512
		const decoder = new TextDecoder('utf-8')

		const readTarString = (
			buffer: Uint8Array,
			offset: number,
			length: number
		): string => {
			const end = offset + length
			let sliceEnd = end
			for (let position = offset; position < end; position += 1) {
				if (buffer[position] === 0) {
					sliceEnd = position
					break
				}
			}
			if (sliceEnd <= offset) {
				return ''
			}
			return decoder
				.decode(buffer.subarray(offset, sliceEnd))
				.replace(/\s+$/g, '')
		}

		const parseOctal = (
			buffer: Uint8Array,
			offset: number,
			length: number
		): number => {
			const raw = decoder
				.decode(buffer.subarray(offset, offset + length))
				.replace(/\0.*$/, '')
				.trim()
			if (raw.length === 0) {
				return 0
			}
			const parsed = Number.parseInt(raw, 8)
			return Number.isNaN(parsed) ? 0 : parsed
		}

		const sanitizeRelativePath = (input: string): string | null => {
			const withoutLeading = input.replace(/^\.\/+/, '')
			const segments = withoutLeading
				.split('/')
				.filter((segment) => segment && segment !== '.')

			if (segments.some((segment) => segment === '..')) {
				return null
			}

			return segments.join('/')
		}

		const dirname = (input: string): string => {
			const segments = input.split('/').filter(Boolean)
			if (segments.length <= 1) {
				return '.'
			}
			segments.pop()
			return segments.join('/')
		}

		const ensureParentDirectory = (path: string, mode?: number) => {
			const parent = dirname(path)
			if (!parent || parent === '.') {
				return
			}
			fs.mkdirSync(parent, { recursive: true, mode: mode ?? 0o755 })
		}

		const isZeroBlock = (buffer: Uint8Array, offset: number): boolean => {
			for (let position = 0; position < blockSize; position += 1) {
				if (buffer[offset + position] !== 0) {
					return false
				}
			}
			return true
		}

		const alignToBlock = (size: number): number =>
			Math.ceil(size / blockSize) * blockSize

		const buildEntryName = (header: Uint8Array): string => {
			const name = readTarString(header, 0, 100)
			const prefix = readTarString(header, 345, 155)
			if (prefix) {
				return `${prefix}/${name}`
			}
			return name
		}

		const parsePaxHeaders = (data: Uint8Array): Record<string, string> => {
			const text = decoder.decode(data)
			const result: Record<string, string> = {}
			let cursor = 0

			// Each record: "%d %s=%s\n"
			while (cursor < text.length) {
				const spaceIndex = text.indexOf(' ', cursor)
				if (spaceIndex === -1) {
					break
				}
				const lengthText = text.slice(cursor, spaceIndex)
				const entryLength = Number.parseInt(lengthText, 10)
				if (
					!Number.isFinite(entryLength) ||
					entryLength <= 0 ||
					cursor + entryLength > text.length + 1
				) {
					break
				}
				const entry = text.slice(
					spaceIndex + 1,
					cursor + entryLength - 1
				)
				const equalsIndex = entry.indexOf('=')
				if (equalsIndex !== -1) {
					const key = entry.slice(0, equalsIndex)
					const value = entry.slice(equalsIndex + 1)
					result[key] = value
				}
				cursor += entryLength
			}

			return result
		}

		const normalizedBase =
			baseDirectory && baseDirectory !== '.'
				? baseDirectory.replace(/\/+$/, '')
				: ''
		if (normalizedBase) {
			try {
				fs.mkdirSync(normalizedBase, { recursive: true, mode: 0o755 })
			} catch (error) {
				writeStderr(
					`extract-tar: cannot prepare target directory ${normalizedBase}: ${errorToString(
						error
					)}`
				)
				exitSafely(1)
				return
			}
		}

		const applyBaseDirectory = (relativePath: string): string => {
			if (!normalizedBase) {
				return relativePath
			}
			if (!relativePath) {
				return normalizedBase
			}
			return `${normalizedBase}/${relativePath}`
		}

		const paxState: {
			current: Record<string, string> | null
		} = { current: null }

		try {
			let offset = 0
			while (offset + blockSize <= tarBytes.length) {
				if (isZeroBlock(tarBytes, offset)) {
					break
				}

				const header = tarBytes.subarray(offset, offset + blockSize)
				const typeChar = header[156]
				const typeFlag =
					typeChar === 0 ? '0' : String.fromCharCode(typeChar)

				const entrySize = paxState.current?.size
					? Number.parseInt(paxState.current.size, 10)
					: parseOctal(header, 124, 12)
				const safeEntrySize = Number.isFinite(entrySize)
					? entrySize
					: 0
				const dataStart = offset + blockSize
				const dataEnd = dataStart + alignToBlock(safeEntrySize)
				const content = tarBytes.subarray(
					dataStart,
					dataStart + safeEntrySize
				)

				if (typeFlag === 'x' || typeFlag === 'X') {
					// PAX extended header applies to the next entry only.
					paxState.current = parsePaxHeaders(content)
					offset = dataEnd
					continue
				}

				if (typeFlag === 'g' || typeFlag === 'G') {
					// Ignore global PAX headers for now.
					offset = dataEnd
					continue
				}

				const rawName =
					paxState.current?.path ?? buildEntryName(header)
				const sanitized = sanitizeRelativePath(rawName)
				if (sanitized === null) {
					writeStderr(
						`extract-tar: skipping unsafe path ${rawName}`
					)
					paxState.current = null
					offset = dataEnd
					continue
				}

				const targetPath = applyBaseDirectory(
					sanitized.replace(/\/+$/, '')
				)
				const rawMode = paxState.current?.mode
					? Number.parseInt(paxState.current.mode, 8)
					: parseOctal(header, 100, 8)
				const entryMode = Number.isFinite(rawMode)
					? (rawMode as number) & 0o777
					: undefined

				const finalize = () => {
					paxState.current = null
					offset = dataEnd
				}

				if (!targetPath) {
					finalize()
					continue
				}

				if (typeFlag === '5' || rawName.endsWith('/')) {
					try {
						fs.mkdirSync(targetPath, {
							recursive: true,
							mode: entryMode ?? 0o755,
						})
						if (verbose) {
							writeStdout(targetPath)
						}
					} catch (error) {
						writeStderr(
							`extract-tar: cannot create directory ${targetPath}: ${errorToString(
								error
							)}`
						)
						exitSafely(1)
						return
					} finally {
						finalize()
					}
					continue
				}

				if (typeFlag === '2') {
					const linkTarget =
						paxState.current?.linkpath ??
						readTarString(header, 157, 100)
					if (!linkTarget) {
						writeStderr(
							`extract-tar: missing link target for ${targetPath}`
						)
						finalize()
						continue
					}
					try {
						ensureParentDirectory(targetPath, entryMode)
						try {
							fs.unlinkSync(targetPath)
						} catch {
							// Ignore missing destinations.
						}
						fs.symlinkSync(linkTarget, targetPath)
						if (verbose) {
							writeStdout(`${targetPath} -> ${linkTarget}`)
						}
					} catch (error) {
						writeStderr(
							`extract-tar: cannot create symlink ${targetPath}: ${errorToString(
								error
							)}`
						)
						exitSafely(1)
						return
					} finally {
						finalize()
					}
					continue
				}

				if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
					try {
						ensureParentDirectory(targetPath, entryMode)
						fs.writeFileSync(targetPath, content, {
							mode: entryMode ?? 0o644,
						})
						if (verbose) {
							writeStdout(targetPath)
						}
					} catch (error) {
						writeStderr(
							`extract-tar: cannot write ${targetPath}: ${errorToString(
								error
							)}`
						)
						exitSafely(1)
						return
					} finally {
						finalize()
					}
					continue
				}

				// Unsupported entry types (block devices, etc.) are skipped but do not fail the extraction.
				writeStderr(
					`extract-tar: skipping unsupported entry ${rawName} (type ${typeFlag})`
				)
				finalize()
			}

			exitSafely(0)
		} catch (error) {
			writeStderr(`extract-tar: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		fflateModuleUrl,
	})});`
}

export const extractTarProgramSource = createProgramSource()
