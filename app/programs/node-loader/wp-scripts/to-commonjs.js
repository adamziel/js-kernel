const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')
const glob = require('glob')

// Check if a package is dual-built (has both ESM and CJS)
function isDualBuilt(packageJson, packageDir) {
  // Check for explicit exports map with both require and import conditions
  if (packageJson.exports) {
    const exports = packageJson.exports
    
    // Handle various export formats and verify files exist
    const checkExports = (exp) => {
      if (typeof exp === 'string') return false
      
      // Check if both require and import exist and their files are present
      if (exp.require && exp.import) {
        const requirePath = typeof exp.require === 'string' ? exp.require : null
        const importPath = typeof exp.import === 'string' ? exp.import : null
        
        if (requirePath && importPath) {
          const requireFile = requirePath.startsWith('./') ? requirePath.slice(2) : requirePath
          const importFile = importPath.startsWith('./') ? importPath.slice(2) : importPath
          
          const requireExists = fs.existsSync(path.join(packageDir, requireFile))
          const importExists = fs.existsSync(path.join(packageDir, importFile))
          
          // Only consider it dual-built if BOTH files exist
          if (requireExists && importExists) {
            return true
          }
        }
      }
      
      if (exp['.']) {
        const dotExport = exp['.']
        if (typeof dotExport === 'object' && dotExport.require && dotExport.import) {
          const requirePath = typeof dotExport.require === 'string' ? dotExport.require : null
          const importPath = typeof dotExport.import === 'string' ? dotExport.import : null
          
          if (requirePath && importPath) {
            const requireFile = requirePath.startsWith('./') ? requirePath.slice(2) : requirePath
            const importFile = importPath.startsWith('./') ? importPath.slice(2) : importPath
            
            const requireExists = fs.existsSync(path.join(packageDir, requireFile))
            const importExists = fs.existsSync(path.join(packageDir, importFile))
            
            if (requireExists && importExists) {
              return true
            }
          }
        }
      }
      return false
    }
    
    if (checkExports(exports)) return true
  }
  
  // Check for both main (CJS) and module (ESM) fields
  if (packageJson.main && packageJson.module) {
    const mainPath = path.join(packageDir, packageJson.main)
    const modulePath = path.join(packageDir, packageJson.module)
    if (fs.existsSync(mainPath) && fs.existsSync(modulePath)) {
      return true
    }
  }
  
  return false
}

// Get all JS files in a package directory, excluding nested node_modules
function getJsFiles(packageDir) {
  const pattern = path.join(packageDir, '**/*.js')
  const files = glob.sync(pattern, {
    ignore: [path.join(packageDir, '**/node_modules/**')],
    nodir: true,
    absolute: true
  })
  return files
}

// Transpile a single file from ESM to CJS
async function transpileFile(filePath, outputPath) {
  // Read file content to check if it contains ESM syntax
  const fileContent = fs.readFileSync(filePath, 'utf8')
  if (!fileContent.includes('import') && !fileContent.includes('export')) {
    console.log(`  Skipping: ${path.basename(filePath)} (no ESM syntax)`)
    return true
  }
  try {
    await esbuild.build({
      entryPoints: [filePath],
      outfile: outputPath,
      format: 'cjs',
      platform: 'node',
      bundle: false, // Don't bundle to avoid needing "external"
      target: 'node14',
		logLevel: 'warning',
	  allowOverwrite: true,
    })
    console.log(`✓ Transpiled: ${path.basename(filePath)}`)
    return true
  } catch (error) {
    console.error(`✗ Error transpiling ${filePath}:`, error.message)
    return false
  }
}

// Process a single package
async function processPackage(packageDir, packageJson, packageName) {  
  // Check if it's ESM
  if (packageJson.type !== 'module') {
    // console.log('  Skipping: not an ESM package')
    return
  }
  
  // Check if it's dual-built
  if (isDualBuilt(packageJson, packageDir)) {
    console.log('  Skipping: already dual-built')
    return
  }
  console.log(`\nProcessing ${packageName}...`)  
  console.log('  Converting to CommonJS...')
  
  // Get all JS files
  const jsFiles = getJsFiles(packageDir)
  console.log(`  Found ${jsFiles.length} JS files`)
  
  let successCount = 0
  let errorCount = 0
  
  // Transpile each file in place
  for (const jsFile of jsFiles) {
    // Create a backup first
    const backupPath = jsFile + '.esm.bak'
    fs.copyFileSync(jsFile, backupPath)
    
    const success = await transpileFile(jsFile, jsFile)
    if (success) {
      successCount++
    } else {
      errorCount++
      // Restore from backup on error
      fs.copyFileSync(backupPath, jsFile)
    }
  }
  
  console.log(`  Done: ${successCount} succeeded, ${errorCount} failed`)
  
  // Update package.json to be a simple CJS package
  if (successCount > 0) {
    const updatedPackageJson = { ...packageJson }
    
    // Remove "type": "module" or change to "commonjs"
    delete updatedPackageJson.type
    
    // Clean up exports field - remove non-existent require entries
    if (updatedPackageJson.exports) {
      const cleanExports = (exports, basePath = packageDir) => {
        if (typeof exports === 'string') {
          const fullPath = path.join(basePath, exports)
          return fs.existsSync(fullPath) ? exports : null
        }
        
        if (typeof exports === 'object' && !Array.isArray(exports)) {
          const cleaned = {}
          
          for (const [key, value] of Object.entries(exports)) {
            if (key === 'require' || key === 'import' || key === 'default') {
              // Check if the file exists
              if (typeof value === 'string') {
                const filePath = value.startsWith('./') ? value.slice(2) : value
                const fullPath = path.join(basePath, filePath)
                if (fs.existsSync(fullPath)) {
                  cleaned[key] = value
                }
              } else {
                cleaned[key] = value
              }
            } else {
              // Recursive clean for nested exports
              const cleanedValue = cleanExports(value, basePath)
              if (cleanedValue !== null && Object.keys(cleanedValue).length > 0) {
                cleaned[key] = cleanedValue
              }
            }
          }
          
          return Object.keys(cleaned).length > 0 ? cleaned : null
        }
        
        return exports
      }
      
      const cleanedExports = cleanExports(updatedPackageJson.exports)
      if (cleanedExports && Object.keys(cleanedExports).length > 0) {
        updatedPackageJson.exports = cleanedExports
      } else {
        delete updatedPackageJson.exports
      }
    }
    
    // Ensure main field exists and points to a valid file
    if (!updatedPackageJson.main) {
      updatedPackageJson.main = 'index.js'
    }
    
    // Write updated package.json
    const packageJsonPath = path.join(packageDir, 'package.json')
    fs.writeFileSync(packageJsonPath, JSON.stringify(updatedPackageJson, null, 2))
    console.log('  Updated package.json to CommonJS format')
  }
}

// Main function
async function main() {
  const packagesDir = path.join(__dirname, 'package', 'node_modules')
  
  if (!fs.existsSync(packagesDir)) {
    console.error(`Error: ${packagesDir} does not exist`)
    process.exit(1)
  }
  
  // Find all package.json files in node_modules/*
  const packageJsonPattern = path.join(packagesDir, '*', 'package.json')
  const packageJsonFiles = glob.sync(packageJsonPattern)
  
  console.log(`Found ${packageJsonFiles.length} packages to check`)
  
  for (const packageJsonPath of packageJsonFiles) {
    try {
      const packageDir = path.dirname(packageJsonPath)
      const packageName = path.basename(packageDir)
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      
      await processPackage(packageDir, packageJson, packageName)
    } catch (error) {
      console.error(`Error processing ${packageJsonPath}:`, error.message)
    }
  }
  
  console.log('\n✅ All done!')
}

// Run the program
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
