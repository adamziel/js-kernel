declare const processController: any

const utilsModuleUrl = new URL('../../runtime/busybox/lib/utils.ts', import.meta.url).href
// const isomorphicGitUrl = 'isomorphic-git'

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
		isomorphicGitUrl: string
	}): Promise<void> {
		const {
			errorToString,
			exitSafely,
			getArgv,
			writeStdout,
			writeStderr,
		} = await import(/* @vite-ignore */ urls.utilsModuleUrl)

		const git = await import(/* @vite-ignore */ urls.isomorphicGitUrl)

		// Create an fs adapter for isomorphic-git from processController
		const createFsAdapter = () => {
			const fs = processController.fs
			const fsSync = processController.fsSync

			return {
				promises: {
					readFile: async (path: string) => {
						try {
							return await fs.readFile(path)
						} catch (error: any) {
							const err = new Error(error.message || 'ENOENT')
							;(err as any).code = error.code || 'ENOENT'
							throw err
						}
					},
					writeFile: async (path: string, data: Uint8Array | string) => {
						return await fs.writeFile(path, data)
					},
					unlink: async (path: string) => {
						return await fs.unlink(path)
					},
					readdir: async (path: string) => {
						return await fs.readdir(path)
					},
					mkdir: async (path: string, options?: any) => {
						return await fs.mkdir(path, options)
					},
					rmdir: async (path: string) => {
						return await fs.rmdir(path)
					},
					stat: async (path: string) => {
						return await fs.stat(path)
					},
					lstat: async (path: string) => {
						return await fs.lstat(path)
					},
					readlink: async (path: string) => {
						return await fs.readlink(path)
					},
					symlink: async (target: string, path: string) => {
						return await fs.symlink(target, path)
					},
					chmod: async (path: string, mode: number) => {
						return await fs.chmod(path, mode)
					},
				},
			}
		}

		const showHelp = () => {
			writeStdout('Usage: git <command> [options]')
			writeStdout('')
			writeStdout('Commands:')
			writeStdout('  clone <url> [dir]       Clone a repository')
			writeStdout('  add <file...>           Add file(s) to staging')
			writeStdout('  rm <file...>            Remove file(s) from staging')
			writeStdout('  commit -m <message>     Commit staged changes')
			writeStdout('  checkout <branch>       Checkout a branch')
			writeStdout('  status                  Show working tree status')
			writeStdout('  log                     Show commit logs')
		}

		try {
			const args = getArgv()
			if (args.length === 0) {
				showHelp()
				exitSafely(0)
				return
			}

			const command = args[0]
			const fs = createFsAdapter()
			const dir = processController.cwd()

			switch (command) {
				case 'clone': {
					if (args.length < 2) {
						writeStderr('Error: git clone requires a URL')
						writeStderr('Usage: git clone <url> [directory]')
						exitSafely(1)
						return
					}

					const url = args[1]
					const targetDir = args[2] || url.split('/').pop()?.replace(/\.git$/, '') || 'repo'
					const fullPath = `${dir}/${targetDir}`.replace(/\/+/g, '/')

					writeStdout(`Cloning into '${targetDir}'...`)

					try {
						await git.clone({
							fs,
							http: {
								fetch: async (url: string, options: any) => {
									// Use the proxy for CORS
									const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`
									return fetch(proxyUrl, options)
								},
							},
							dir: fullPath,
							url,
							corsProxy: '/proxy?url=',
							singleBranch: true,
							depth: 1,
						})
						writeStdout(`Successfully cloned ${url} to ${targetDir}`)
						exitSafely(0)
					} catch (error) {
						writeStderr(`Failed to clone repository: ${errorToString(error)}`)
						exitSafely(1)
					}
					break
				}

				case 'add': {
					if (args.length < 2) {
						writeStderr('Error: git add requires file path(s)')
						exitSafely(1)
						return
					}

					const files = args.slice(1)
					for (const filepath of files) {
						try {
							await git.add({ fs, dir, filepath })
							writeStdout(`Added ${filepath}`)
						} catch (error) {
							writeStderr(`Failed to add ${filepath}: ${errorToString(error)}`)
							exitSafely(1)
							return
						}
					}
					exitSafely(0)
					break
				}

				case 'rm': {
					if (args.length < 2) {
						writeStderr('Error: git rm requires file path(s)')
						exitSafely(1)
						return
					}

					const files = args.slice(1)
					for (const filepath of files) {
						try {
							await git.remove({ fs, dir, filepath })
							writeStdout(`Removed ${filepath}`)
						} catch (error) {
							writeStderr(`Failed to remove ${filepath}: ${errorToString(error)}`)
							exitSafely(1)
							return
						}
					}
					exitSafely(0)
					break
				}

				case 'commit': {
					const messageIndex = args.indexOf('-m')
					if (messageIndex === -1 || messageIndex === args.length - 1) {
						writeStderr('Error: git commit requires -m <message>')
						exitSafely(1)
						return
					}

					const message = args[messageIndex + 1]
					try {
						const sha = await git.commit({
							fs,
							dir,
							author: {
								name: 'User',
								email: 'user@example.com',
							},
							message,
						})
						writeStdout(`[${sha.substring(0, 7)}] ${message}`)
						exitSafely(0)
					} catch (error) {
						writeStderr(`Failed to commit: ${errorToString(error)}`)
						exitSafely(1)
					}
					break
				}

				case 'checkout': {
					if (args.length < 2) {
						writeStderr('Error: git checkout requires a branch name')
						exitSafely(1)
						return
					}

					const ref = args[1]
					try {
						await git.checkout({ fs, dir, ref })
						writeStdout(`Switched to branch '${ref}'`)
						exitSafely(0)
					} catch (error) {
						writeStderr(`Failed to checkout ${ref}: ${errorToString(error)}`)
						exitSafely(1)
					}
					break
				}

				case 'status': {
					try {
						const FILE = 0
						const HEAD = 1
						const WORKDIR = 2
						const STAGE = 3

						const status = await git.statusMatrix({ fs, dir })
						
						let hasChanges = false
						const staged: string[] = []
						const modified: string[] = []
						const untracked: string[] = []

						for (const [filepath, headStatus, workdirStatus, stageStatus] of status) {
							// New file, staged
							if (headStatus === 0 && workdirStatus === 2 && stageStatus === 2) {
								staged.push(filepath)
								hasChanges = true
							}
							// Modified, staged
							else if (headStatus === 1 && workdirStatus === 2 && stageStatus === 2) {
								staged.push(filepath)
								hasChanges = true
							}
							// Modified, not staged
							else if (headStatus === 1 && workdirStatus === 2 && stageStatus === 1) {
								modified.push(filepath)
								hasChanges = true
							}
							// Untracked
							else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
								untracked.push(filepath)
								hasChanges = true
							}
							// Deleted, staged
							else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 0) {
								staged.push(filepath)
								hasChanges = true
							}
						}

						if (!hasChanges) {
							writeStdout('nothing to commit, working tree clean')
						} else {
							if (staged.length > 0) {
								writeStdout('Changes to be committed:')
								for (const file of staged) {
									writeStdout(`  ${file}`)
								}
								writeStdout('')
							}
							if (modified.length > 0) {
								writeStdout('Changes not staged for commit:')
								for (const file of modified) {
									writeStdout(`  ${file}`)
								}
								writeStdout('')
							}
							if (untracked.length > 0) {
								writeStdout('Untracked files:')
								for (const file of untracked) {
									writeStdout(`  ${file}`)
								}
							}
						}
						exitSafely(0)
					} catch (error) {
						writeStderr(`Failed to get status: ${errorToString(error)}`)
						exitSafely(1)
					}
					break
				}

				case 'log': {
					try {
						const commits = await git.log({ fs, dir, depth: 10 })
						for (const commit of commits) {
							writeStdout(`commit ${commit.oid}`)
							writeStdout(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`)
							writeStdout(`Date:   ${new Date(commit.commit.author.timestamp * 1000).toISOString()}`)
							writeStdout('')
							writeStdout(`    ${commit.commit.message}`)
							writeStdout('')
						}
						exitSafely(0)
					} catch (error) {
						writeStderr(`Failed to get log: ${errorToString(error)}`)
						exitSafely(1)
					}
					break
				}

				case 'help':
				case '--help':
				case '-h':
					showHelp()
					exitSafely(0)
					break

				default:
					writeStderr(`Unknown command: ${command}`)
					showHelp()
					exitSafely(1)
					break
			}
		} catch (error) {
			writeStderr(`git: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		isomorphicGitUrl,
	})});`
}

export const gitProgramSource = createProgramSource()

