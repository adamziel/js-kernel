use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use flash::{lexer::Lexer, parser::Parser};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct ParseResult {
    pub success: bool,
    pub ast: String,
    pub error: Option<String>,
}

#[wasm_bindgen]
pub fn parse_shell_code(input: &str) -> JsValue {
    console_log!("Parsing input: {}", input);
    
    let result = match parse_internal(input) {
        Ok(ast) => {
            let ast_json = serde_json::to_string_pretty(&ast)
                .unwrap_or_else(|e| format!("Failed to serialize AST: {}", e));
            ParseResult {
                success: true,
                ast: ast_json,
                error: None,
            }
        },
        Err(e) => ParseResult {
            success: false,
            ast: String::new(),
            error: Some(e),
        },
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

fn parse_internal(input: &str) -> Result<flash::parser::Node, String> {
    let lexer = Lexer::new(input);
    let mut parser = Parser::new(lexer);
    
    Ok(parser.parse_script())
}

#[wasm_bindgen(start)]
pub fn main() {
    console_log!("Flash WebAssembly parser initialized!");
}