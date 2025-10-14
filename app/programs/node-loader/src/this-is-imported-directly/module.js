import path from '../../dist/path.js'
import fs from '../../dist/fs.js'
const ModuleCJSLoader = (
	await import('../../dist/internal/modules/cjs/loader.js')
).default

const NodeBuffer = globalThis.Buffer

export const kModuleSource = ModuleCJSLoader.kModuleSource
export const kModuleExport = ModuleCJSLoader.kModuleExport
export const kModuleExportNames = ModuleCJSLoader.kModuleExportNames
export const kModuleCircularVisited = ModuleCJSLoader.kModuleCircularVisited
export const initializeCJS = ModuleCJSLoader.initializeCJS
export const Module = ModuleCJSLoader.Module

const DEFAULT_EXPORT_CONDITIONS = Object.freeze(['node', 'require', 'default'])
const EXPORTS_PATTERN = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/
const packageJsonCache = new Map()

function isRelativeRequest(request) {
	return (
		request === '.' ||
		request === '..' ||
		request.startsWith('./') ||
		request.startsWith('../')
	)
}

function toPathString(input) {
	if (typeof input === 'string') {
		return input
	}
	if (typeof input === 'object' && input !== null) {
		if (
			NodeBuffer &&
			typeof NodeBuffer.isBuffer === 'function' &&
			NodeBuffer.isBuffer(input)
		) {
			return input.toString()
		}
		if (typeof input.path === 'string') {
			return input.path
		}
	}
	return String(input)
}

function isPathNotFoundError(error) {
	return Boolean(
		error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
	)
}

function scheduleAsync(callback) {
	if (typeof queueMicrotask === 'function') {
		queueMicrotask(callback)
		return
	}
	Promise.resolve().then(callback)
}

function getRealpathFn() {
	if (typeof fs?.realpathSync?.native === 'function') {
		return fs.realpathSync.native
	}
	if (typeof fs?.realpathSync === 'function') {
		return fs.realpathSync
	}
	return null
}

function resolveRealpathWithSymlinks(inputPath, seen = new Set()) {
	if (
		typeof fs?.lstatSync !== 'function' ||
		typeof fs?.readlinkSync !== 'function'
	) {
		return null
	}
	const absoluteInput = path.resolve(inputPath)
	const parsed = path.parse(absoluteInput)
	const segments = absoluteInput
		.slice(parsed.root.length)
		.split(path.sep)
		.filter(Boolean)
	let currentPath = parsed.root || path.sep
	for (let index = 0; index < segments.length; index += 1) {
		currentPath = path.join(currentPath, segments[index])
		let stats
		try {
			stats = fs.lstatSync(currentPath)
		} catch (error) {
			if (isPathNotFoundError(error)) {
				return null
			}
			throw error
		}
		if (stats?.isSymbolicLink?.()) {
			const canonicalCurrent = path.resolve(currentPath)
			if (seen.has(canonicalCurrent)) {
				const loopError = new Error(
					`ELOOP: too many symbolic links encountered while resolving '${inputPath}'`
				)
				loopError.code = 'ELOOP'
				throw loopError
			}
			seen.add(canonicalCurrent)
			let linkTarget
			try {
				linkTarget = fs.readlinkSync(canonicalCurrent)
			} catch (error) {
				if (isPathNotFoundError(error) || error?.code === 'EINVAL') {
					return null
				}
				throw error
			}
			const resolvedTarget = path.isAbsolute(linkTarget)
				? linkTarget
				: path.resolve(path.dirname(canonicalCurrent), linkTarget)
			const remaining = segments.slice(index + 1)
			const nextPath =
				remaining.length > 0
					? path.resolve(resolvedTarget, ...remaining)
					: resolvedTarget
			return resolveRealpathWithSymlinks(nextPath, seen)
		}
	}
	return absoluteInput
}

function formatRealpathResult(resolvedPath, options) {
	const encoding =
		typeof options === 'string'
			? options
			: typeof options === 'object' && options !== null
			? options.encoding
			: undefined
	if (encoding === 'buffer') {
		if (NodeBuffer && typeof NodeBuffer.from === 'function') {
			return NodeBuffer.from(resolvedPath)
		}
		throw new Error(
			'Buffer is not available to encode realpath result as buffer'
		)
	}
	if (!encoding || encoding === 'utf8') {
		return resolvedPath
	}
	if (NodeBuffer && typeof NodeBuffer.from === 'function') {
		return NodeBuffer.from(resolvedPath).toString(encoding)
	}
	throw new Error(
		'Buffer is not available to encode realpath result with custom encoding'
	)
}

function createRealpathNotFoundError(requestPath) {
	const error = new Error(
		`ENOENT: no such file or directory, realpath '${requestPath}'`
	)
	error.code = 'ENOENT'
	error.path = requestPath
	error.syscall = 'realpath'
	return error
}

function realpathSyncWithSymlinkFallback(requestPath, options) {
	const pathString = toPathString(requestPath)
	const manualResolved = resolveRealpathWithSymlinks(pathString)
	if (!manualResolved) {
		throw createRealpathNotFoundError(pathString)
	}
	return formatRealpathResult(manualResolved, options)
}

function patchFsRealpath() {
	if (!fs) {
		return
	}
	const originalRealpathSync =
		typeof fs.realpathSync === 'function' ? fs.realpathSync.bind(fs) : null
	const patchedRealpathSync = function patchedRealpathSync(
		requestPath,
		options
	) {
		try {
			if (originalRealpathSync) {
				return originalRealpathSync(requestPath, options)
			}
		} catch (error) {
			if (!isPathNotFoundError(error) && error?.code !== 'ELOOP') {
				throw error
			}
		}
		return realpathSyncWithSymlinkFallback(requestPath, options)
	}
	patchedRealpathSync.native = function patchedRealpathNative(
		requestPath,
		options
	) {
		return realpathSyncWithSymlinkFallback(requestPath, options)
	}
	fs.realpathSync = patchedRealpathSync
	fs.realpathSync.native = patchedRealpathSync.native
	if (typeof fs.realpath === 'function') {
		fs.realpath = function patchedRealpath(requestPath, options, callback) {
			let cb = callback
			let opts = options
			if (typeof opts === 'function') {
				cb = opts
				opts = undefined
			}
			if (typeof cb === 'function') {
				scheduleAsync(() => {
					try {
						const result = realpathSyncWithSymlinkFallback(
							requestPath,
							opts
						)
						cb(null, result)
					} catch (error) {
						cb(error)
					}
				})
				return
			}
			return new Promise((resolve, reject) => {
				scheduleAsync(() => {
					try {
						const result = realpathSyncWithSymlinkFallback(
							requestPath,
							opts
						)
						resolve(result)
					} catch (error) {
						reject(error)
					}
				})
			})
		}
	}
}

patchFsRealpath()

function safeRealpath(absolutePath) {
	const realpathFn = getRealpathFn()
	if (realpathFn) {
		try {
			return realpathFn(absolutePath)
		} catch (error) {
			try {
				const manualResolved = resolveRealpathWithSymlinks(absolutePath)
				if (manualResolved) {
					return manualResolved
				}
			} catch (manualError) {
				if (manualError?.code !== 'ELOOP') {
					throw manualError
				}
				return path.resolve(absolutePath)
			}
			if (
				error &&
				(error.code === 'ENOENT' ||
					error.code === 'ENOTDIR' ||
					error.code === 'ELOOP')
			) {
				return path.resolve(absolutePath)
			}
			throw error
		}
	}
	try {
		const manualResolved = resolveRealpathWithSymlinks(absolutePath)
		if (manualResolved) {
			return manualResolved
		}
	} catch (manualError) {
		if (manualError?.code !== 'ELOOP') {
			throw manualError
		}
	}
	return path.resolve(absolutePath)
}

function statPath(targetPath) {
	if (!targetPath) {
		return -1
	}
	try {
		const stats = fs.statSync(targetPath)
		if (
			stats.isFile() ||
			stats.isFIFO?.() ||
			stats.isSocket?.() ||
			stats.isSymbolicLink?.()
		) {
			return 0
		}
		if (stats.isDirectory()) {
			return 1
		}
		return 2
	} catch (error) {
		if (
			error &&
			(error.code === 'ENOENT' ||
				error.code === 'ENOTDIR' ||
				error.code === 'ELOOP')
		) {
			try {
				const manualResolved = resolveRealpathWithSymlinks(targetPath)
				if (manualResolved) {
					try {
						const stats = fs.statSync(manualResolved)
						if (
							stats.isFile() ||
							stats.isFIFO?.() ||
							stats.isSocket?.() ||
							stats.isSymbolicLink?.()
						) {
							return 0
						}
						if (stats.isDirectory()) {
							return 1
						}
					} catch (manualError) {
						if (
							!isPathNotFoundError(manualError) &&
							manualError?.code !== 'ELOOP'
						) {
							throw manualError
						}
					}
				}
			} catch (manualResolveError) {
				if (manualResolveError?.code !== 'ELOOP') {
					throw manualResolveError
				}
			}
			return -1
		}
		throw error
	}
}

function readPackage(dirPath) {
	const packageJsonPath = path.join(dirPath, 'package.json')
	const cached = packageJsonCache.get(packageJsonPath)
	if (cached) {
		return cached
	}
	try {
		const raw = fs.readFileSync(packageJsonPath, 'utf8')
		const data = JSON.parse(raw)
		const entry = {
			exists: true,
			path: packageJsonPath,
			data,
			main: data.main,
			exports: data.exports,
		}
		packageJsonCache.set(packageJsonPath, entry)
		return entry
	} catch (error) {
		if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
			const entry = { exists: false, path: packageJsonPath }
			packageJsonCache.set(packageJsonPath, entry)
			return entry
		}
		throw error
	}
}

function selectConditionalTarget(target, conditions, patternMatch) {
	if (target == null) {
		return null
	}
	if (typeof target === 'string') {
		return { target, patternMatch }
	}
	if (Array.isArray(target)) {
		for (const candidate of target) {
			const resolved = selectConditionalTarget(
				candidate,
				conditions,
				patternMatch
			)
			if (resolved) {
				return resolved
			}
		}
		return null
	}
	if (typeof target === 'object') {
		for (const condition of conditions) {
			if (Object.prototype.hasOwnProperty.call(target, condition)) {
				const resolved = selectConditionalTarget(
					target[condition],
					conditions,
					patternMatch
				)
				if (resolved) {
					return resolved
				}
			}
		}
		if (Object.prototype.hasOwnProperty.call(target, 'default')) {
			return selectConditionalTarget(
				target.default,
				conditions,
				patternMatch
			)
		}
	}
	return null
}

function resolveExportsTarget(exportsField, subpath, conditions) {
	if (exportsField == null) {
		return null
	}
	if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
		return selectConditionalTarget(exportsField, conditions)
	}
	if (typeof exportsField !== 'object') {
		return null
	}
	if (Object.keys(exportsField).every((key) => key[0] !== '.')) {
		return selectConditionalTarget(exportsField, conditions)
	}
	if (Object.prototype.hasOwnProperty.call(exportsField, subpath)) {
		return selectConditionalTarget(exportsField[subpath], conditions)
	}
	if (subpath !== '.') {
		for (const key of Object.keys(exportsField)) {
			if (!key.endsWith('*')) {
				continue
			}
			const baseKey = key.slice(0, -1)
			if (!subpath.startsWith(baseKey)) {
				continue
			}
			const patternMatch = subpath.slice(baseKey.length)
			const resolved = selectConditionalTarget(
				exportsField[key],
				conditions,
				patternMatch
			)
			if (resolved) {
				return resolved
			}
		}
	}
	return null
}

function materializeExportsTarget(
	packageRoot,
	targetEntry,
	exts,
	isMain,
	request,
	conditions,
	seenDirs
) {
	if (!targetEntry) {
		return null
	}
	const { target, patternMatch } = targetEntry
	if (typeof target !== 'string' || !target.startsWith('./')) {
		return null
	}
	let relativeTarget = target
	if (patternMatch !== undefined) {
		if (!target.includes('*')) {
			return null
		}
		relativeTarget = target.replace('*', patternMatch)
	}
	const resolved = path.resolve(packageRoot, relativeTarget)
	return finalizeResolvedPath(
		resolved,
		exts,
		isMain,
		request,
		conditions,
		seenDirs
	)
}

function tryFile(filePath) {
	const statResult = statPath(filePath)
	if (statResult === 0) {
		return safeRealpath(filePath)
	}
	return false
}

function tryExtensions(basePath, exts) {
	for (const ext of exts) {
		const filename = tryFile(basePath + ext)
		if (filename) {
			return filename
		}
	}
	return false
}

function resolveIndex(targetPath, exts, isMain, request, conditions, seenDirs) {
	return finalizeResolvedPath(
		path.join(targetPath, 'index'),
		exts,
		isMain,
		request,
		conditions,
		seenDirs
	)
}

function resolvePackageDirectory(
	targetPath,
	exts,
	isMain,
	request,
	conditions,
	seenDirs
) {
	const realTarget = safeRealpath(targetPath)
	if (seenDirs.has(realTarget)) {
		return false
	}
	seenDirs.add(realTarget)
	const pkg = readPackage(targetPath)
	if (pkg?.exists) {
		const exportsConditions = conditions ?? DEFAULT_EXPORT_CONDITIONS
		const exportsResult = resolveExportsTarget(
			pkg.exports,
			'.',
			exportsConditions
		)
		const materialized = materializeExportsTarget(
			targetPath,
			exportsResult,
			exts,
			isMain,
			request,
			conditions,
			seenDirs
		)
		if (materialized) {
			return materialized
		}
		if (pkg.main) {
			const mainTarget = path.resolve(targetPath, pkg.main)
			if (safeRealpath(mainTarget) !== realTarget) {
				const mainResolved = finalizeResolvedPath(
					mainTarget,
					exts,
					isMain,
					request,
					conditions,
					seenDirs
				)
				if (mainResolved) {
					return mainResolved
				}
			}
		}
	}
	return resolveIndex(targetPath, exts, isMain, request, conditions, seenDirs)
}

function finalizeResolvedPath(
	resolvedPath,
	exts,
	isMain,
	request,
	conditions,
	seenDirs
) {
	const statResult = statPath(resolvedPath)
	if (statResult === 0) {
		return safeRealpath(resolvedPath)
	}
	if (statResult === 1) {
		return resolvePackageDirectory(
			resolvedPath,
			exts,
			isMain,
			request,
			conditions,
			seenDirs
		)
	}
	if (statResult === -1) {
		if (exts.length > 0) {
			const withExts = tryExtensions(resolvedPath, exts)
			if (withExts) {
				return withExts
			}
		}
	}
	return false
}

function resolveExportsFromPath(
	basePath,
	request,
	exts,
	isMain,
	conditions,
	seenDirs
) {
	const match = EXPORTS_PATTERN.exec(request)
	if (!match) {
		return null
	}
	const [, packageName, expansion = ''] = match
	const packageRoot = path.resolve(basePath, packageName)
	const pkg = readPackage(packageRoot)
	if (!pkg?.exists || pkg.exports == null) {
		return null
	}
	const subpath = expansion ? `.${expansion}` : '.'
	const target = resolveExportsTarget(
		pkg.exports,
		subpath,
		conditions ?? DEFAULT_EXPORT_CONDITIONS
	)
	return materializeExportsTarget(
		packageRoot,
		target,
		exts,
		isMain,
		request,
		conditions,
		seenDirs
	)
}

Module._findPath = function (request, paths, isMain, conditions) {
	if (typeof request !== 'string' || request.length === 0) {
		return false
	}
	if (
		request.startsWith('node:') ||
		globalThis.coreModules?.[request] ||
		Module.builtinModules?.includes?.(request)
	) {
		return request
	}
	let searchPaths = paths
	const absoluteRequest = path.isAbsolute(request)
	if (absoluteRequest) {
		searchPaths = ['']
	} else if (!Array.isArray(searchPaths) || searchPaths.length === 0) {
		return false
	}
	const cacheKey = `${request}\0${searchPaths.join('\0')}`
	const cached = Module._pathCache?.[cacheKey]
	if (cached) {
		return cached
	}
	let extensions = null
	const seenDirectories = new Set()
	const trailingSlash = request.endsWith('/') || request.endsWith('..')
	let insidePath = true
	if (isRelativeRequest(request)) {
		const normalized = path.normalize(request)
		if (normalized.startsWith('..')) {
			insidePath = false
		}
	}
	for (const currentPath of searchPaths) {
		if (typeof currentPath !== 'string') {
			continue
		}
		if (insidePath && currentPath && statPath(currentPath) < 1) {
			continue
		}
		if (!absoluteRequest) {
			const candidateExts =
				extensions ?? Object.keys(Module._extensions ?? { '.js': true })
			const exportsResolved = resolveExportsFromPath(
				currentPath,
				request,
				candidateExts,
				isMain,
				conditions ?? DEFAULT_EXPORT_CONDITIONS,
				seenDirectories
			)
			if (exportsResolved) {
				Module._pathCache[cacheKey] = exportsResolved
				return exportsResolved
			}
		}
		const basePath = path.resolve(currentPath, request)
		if (extensions === null) {
			extensions = Object.keys(Module._extensions ?? { '.js': true })
		}
		let filename = null
		if (!trailingSlash) {
			filename = finalizeResolvedPath(
				basePath,
				extensions,
				isMain,
				request,
				conditions,
				seenDirectories
			)
		}
		if (!filename && statPath(basePath) === 1) {
			filename = resolvePackageDirectory(
				basePath,
				extensions,
				isMain,
				request,
				conditions,
				seenDirectories
			)
		}
		if (filename) {
			Module._pathCache[cacheKey] = filename
			return filename
		}
	}
	return false
}

export const runMain = Module.runMain
export const findLongestRegisteredExtension =
	ModuleCJSLoader.findLongestRegisteredExtension
export const resolveForCJSWithHooks = ModuleCJSLoader.resolveForCJSWithHooks
export const loadSourceForCJSWithHooks =
	ModuleCJSLoader.loadSourceForCJSWithHooks
export const populateCJSExportsFromESM =
	ModuleCJSLoader.populateCJSExportsFromESM
export const wrapSafe = ModuleCJSLoader.wrapSafe
export const wrapModuleLoad = ModuleCJSLoader.wrapModuleLoad
export const kIsMainSymbol = ModuleCJSLoader.kIsMainSymbol
export const kIsCachedByESMLoader = ModuleCJSLoader.kIsCachedByESMLoader
export const kRequiredModuleSymbol = ModuleCJSLoader.kRequiredModuleSymbol
export const kIsExecuting = ModuleCJSLoader.kIsExecuting
export const builtinModules = Object.keys(globalThis.coreModules)
export const globalPaths = Module.globalPaths
