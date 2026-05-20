import numpy as np
import joblib
import os

def test_model():
    model_path = os.path.join(os.getcwd(), "model", "tremor_model.pkl")
    
    if not os.path.exists(model_path):
        print("Model file not found! Please train the model first.")
        return

    # Load the model
    print(f"Loading model from: {model_path}")
    model = joblib.load(model_path)
    
    # Let's create two dummy test cases based on the features: [Mean, Std, Max, Min]
    # Class 0: Normal (Low amplitude noise, low std, small max/min)
    normal_case = [[0.001, 0.04, 0.12, -0.11]]
    
    # Class 1: Parkinson (Higher amplitude sine wave, high std, large max/min)
    parkinson_case = [[0.01, 0.8, 1.5, -1.4]]
    
    print("\n--- Running Predictions ---")
    
    # Predict Normal
    pred1 = model.predict(normal_case)
    result1 = "Parkinson Tremor" if pred1[0] == 1 else "Normal"
    print(f"Test Case 1 (Low movement)  -> Prediction: {result1}")
    
    # Predict Parkinson
    pred2 = model.predict(parkinson_case)
    result2 = "Parkinson Tremor" if pred2[0] == 1 else "Normal"
    print(f"Test Case 2 (High movement) -> Prediction: {result2}")
    
if __name__ == "__main__":
    test_model()
