import os
import subprocess
import tempfile
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import ast

app = Flask(__name__)
CORS(app)

@app.route('/debug', methods=['POST'])
def debug_code():
    data = request.get_json()
    code = data.get('code')
    language = data.get('language')
    user_input = data.get('user_input', "")

    if not code or not language:
        return jsonify({"error": "Code or language missing"}), 400

    output_response = execute_code(code, language, user_input)
    questions = generate_questions(code)

    try:
        tree = ast.parse(code)
        execution_steps = generate_execution_steps(tree, code)
    except SyntaxError as e:
        return jsonify({
            "output": output_response.get("output", ""),
            "error": output_response.get("error", str(e)),
            "questions": questions
        })

    return jsonify({
        "output": output_response.get("output", ""),
        "error": output_response.get("error", ""),
        "questions": questions,
        "execution_steps": execution_steps,
    })

@app.route('/autocorrect', methods=['POST'])
def auto_correct_code():
    data = request.get_json()
    code = data.get('code')

    if not code:
        return jsonify({"error": "Code missing"}), 400

    result = correct_code_using_mistral(code)
    if isinstance(result, dict):
        return jsonify(result)
    else:
        return jsonify({
            "corrected_code": result
        })

def execute_code(code, language, user_input=""):
    try:
        with tempfile.NamedTemporaryFile(suffix=f'.{language}', delete=False) as temp_file:
            temp_file.write(code.encode())
            temp_file.close()

            if language == "python":
                python_executable = sys.executable
                result = subprocess.run([python_executable, temp_file.name], input=user_input.encode(), capture_output=True, text=True)
            elif language == "cpp":
                exe_file = temp_file.name.replace('.cpp', '.exe')
                compile_command = f"g++ \"{temp_file.name}\" -o \"{exe_file}\""
                compile_result = subprocess.run(compile_command, shell=True, capture_output=True, text=True)
                if compile_result.returncode != 0:
                    return {"error": compile_result.stderr or "Compilation failed. Make sure g++ is installed and in your PATH."}
                try:
                    result = subprocess.run(f"\"{exe_file}\"", shell=True, input=user_input.encode(), capture_output=True, text=True)
                    if os.path.exists(exe_file):
                        try:
                            os.remove(exe_file)
                        except:
                            pass
                except Exception as e:
                    return {"error": f"Error executing C++ code: {str(e)}"}
            elif language == "java":
                class_name = extract_java_class_name(code)
                if not class_name:
                    return {"error": "No public class found in Java code."}

                temp_dir = os.path.dirname(temp_file.name)
                java_file_name = f"{temp_dir}/{class_name}.java"

                if os.path.exists(java_file_name):
                    os.remove(java_file_name)

                os.rename(temp_file.name, java_file_name)

                if not os.path.exists(java_file_name):
                    return {"error": "Renaming failed"}

                compile_result = subprocess.run(['javac', java_file_name], capture_output=True, text=True)
                if compile_result.returncode != 0:
                    return {"error": compile_result.stderr}

                result = subprocess.run(['java', '-cp', temp_dir, class_name], input=user_input.encode(), capture_output=True, text=True)

                if os.path.exists(java_file_name):
                    os.remove(java_file_name)
            elif language == "c":
                exe_file = temp_file.name.replace('.c', '.exe')
                compile_command = f"gcc \"{temp_file.name}\" -o \"{exe_file}\""
                compile_result = subprocess.run(compile_command, shell=True, capture_output=True, text=True)
                if compile_result.returncode != 0:
                    return {"error": compile_result.stderr or "Compilation failed. Make sure gcc is installed and in your PATH."}
                try:
                    result = subprocess.run(f"\"{exe_file}\"", shell=True, input=user_input.encode(), capture_output=True, text=True)
                    if os.path.exists(exe_file):
                        try:
                            os.remove(exe_file)
                        except:
                            pass
                except Exception as e:
                    return {"error": f"Error executing C code: {str(e)}"}
            else:
                return {"error": "Unsupported language"}

            os.remove(temp_file.name)
            return {"output": result.stdout if result.returncode == 0 else "", "error": result.stderr if result.returncode != 0 else ""}
    except Exception as e:
        return {"error": str(e)}

def generate_questions(code):
    try:
        MISTRAL_API_KEY = "" #replace your api
        url = "https://api.mistral.ai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "mistral-medium",
            "messages": [{"role": "user", "content": f"Analyze the following code and generate 5 conceptual or practical questions:\n\n{code}"}]
        }
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            result = response.json()
            questions = result["choices"][0]["message"]["content"].strip()
            return questions.split("\n")
        else:
            return [f"Error: {response.status_code} - {response.text}"]
    except Exception as e:
        return [f"Error generating questions: {str(e)}"]

def extract_java_class_name(code):
    import re
    match = re.search(r'public\s+class\s+(\w+)', code)
    return match.group(1) if match else None

def correct_code_using_mistral(code):
    try:
        MISTRAL_API_KEY = "" #replace your api
        url = "https://api.mistral.ai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # First request to get corrected code
        payload = {
            "model": "mistral-medium",
            "messages": [
                {"role": "system", "content": "You are a code correction tool. Respond ONLY with the corrected code. Do not include any explanations, introductory text, markdown formatting, or HTML."},
                {"role": "user", "content": f"Correct the following code snippet:\n\n{code}"}
            ]
        }

        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            return {"error": f"Error: {response.status_code} - {response.text}"}
            
        response_data = response.json()
        corrected_code = response_data["choices"][0]["message"]["content"].strip()
        
        # Second request to get explanation
        explanation_payload = {
            "model": "mistral-medium",
            "messages": [
                {"role": "system", "content": "You are a code explanation tool. Provide a brief explanation of what you fixed in the code."},
                {"role": "user", "content": f"Original code:\n\n{code}\n\nCorrected code:\n\n{corrected_code}\n\nExplain what was fixed, focusing only on the corrections made."}
            ]
        }
        
        explanation_response = requests.post(url, headers=headers, json=explanation_payload)
        
        if explanation_response.status_code == 200:
            explanation_data = explanation_response.json()
            explanation = explanation_data["choices"][0]["message"]["content"].strip()
            
            return {
                "corrected_code": corrected_code,
                "explanation": explanation
            }
        else:
            # Return just the corrected code if explanation fails
            return {
                "corrected_code": corrected_code,
                "explanation": "Code has been corrected."
            }
            
    except Exception as e:
        return {"error": f"Error: {str(e)}"}

def generate_execution_steps(tree, code):
    steps = []
    lines = code.split('\n')
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            line_no = node.lineno -1
            target = ast.unparse(node.targets[0])
            value = ast.unparse(node.value)
            steps.append({
                "lineNumber": line_no,
                "stepDescription": f"{target} = {value}"
            })
        elif isinstance(node, ast.Expr):
            line_no = node.lineno -1
            value = ast.unparse(node.value)
            steps.append({
                "lineNumber": line_no,
                "stepDescription": f"{value}"
            })
        elif isinstance(node, ast.If):
            line_no = node.lineno - 1;
            test = ast.unparse(node.test)
            steps.append({
                "lineNumber": line_no,
                "stepDescription": f"If {test}"
            })

    return steps

if __name__ == '__main__':
    app.run(debug=True)
