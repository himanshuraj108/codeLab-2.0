import subprocess
import tempfile
import os

def debug_code(code):
    try:
        with tempfile.NamedTemporaryFile(suffix=".cpp", delete=False) as temp_file:
            temp_file.write(code.encode())
            temp_file_path = temp_file.name

        compile_command = f"g++ \"{temp_file_path}\" -o \"temp_output.exe\""
        exec_command = "\"temp_output.exe\""

        compile_process = subprocess.run(compile_command, shell=True, capture_output=True, text=True)
        if compile_process.returncode != 0:
            return compile_process.stderr or "Compilation failed. Make sure g++ is installed and in your PATH."

        try:
            exec_process = subprocess.run(exec_command, shell=True, capture_output=True, text=True)
            result = exec_process.stdout or exec_process.stderr
        except Exception as e:
            result = f"Error executing C++ code: {str(e)}"
        
        # Clean up temporary files
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            if os.path.exists("temp_output.exe"):
                os.remove("temp_output.exe")
        except:
            pass
            
        return result
    except Exception as e:
        return str(e)