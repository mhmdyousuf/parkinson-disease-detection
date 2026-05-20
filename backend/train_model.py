import numpy as np
import os
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

def generate_synthetic_data(samples=1000):
    """
    Generates synthetic tremor data for training.
    Features: [Mean, Std, Max, Min] of the zero-mean magnitude signal.
    Class 0: Normal / No Tremor
    Class 1: Parkinson Tremor
    """
    X = []
    y = []

    # --- Generate Class 0: Normal (Low noise) ---
    for _ in range(samples):
        # Very low amplitude random noise
        duration = 30 # seconds
        fs = 50 # 50Hz
        t = np.linspace(0, duration, duration * fs)
        
        # Noise level < 0.15 (our threshold)
        noise = np.random.normal(0, 0.04, len(t))
        signal = noise - np.mean(noise)
        
        X.append([np.mean(signal), np.std(signal), np.max(signal), np.min(signal)])
        y.append(0)

    # --- Generate Class 1: Parkinson (4-6 Hz Tremor) ---
    for _ in range(samples):
        duration = 30
        fs = 50
        t = np.linspace(0, duration, duration * fs)
        
        # Random frequency between 4-6 Hz
        freq = np.random.uniform(4, 6)
        # Amplitude between 0.2 and 1.5 (Significant)
        amp = np.random.uniform(0.3, 1.2)
        
        tremor = amp * np.sin(2 * np.pi * freq * t)
        noise = np.random.normal(0, 0.1, len(t)) # Adding some noise
        signal = (tremor + noise)
        signal = signal - np.mean(signal)
        
        X.append([np.mean(signal), np.std(signal), np.max(signal), np.min(signal)])
        y.append(1)

    return np.array(X), np.array(y)

def train_and_save():
    print("Generating high-quality synthetic data for NeuroTrack...")
    X, y = generate_synthetic_data(2000)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print(f"Training set: {len(X_train)} samples, Test set: {len(X_test)} samples")

    # Initialize model
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    
    # Train
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    
    print("\nTraining Complete!")
    print(f"Model Accuracy: {accuracy * 100:.2f}%")
    print("\nDetailed Report:")
    print(classification_report(y_test, y_pred, target_names=["Normal", "Parkinson"]))

    # Save
    model_dir = os.path.join(os.getcwd(), "backend", "model")
    if not os.path.exists(model_dir):
        os.makedirs(model_dir)
        
    model_path = os.path.join(model_dir, "tremor_model.pkl")
    joblib.dump(model, model_path)
    print(f"\nModel saved successfully at: {model_path}")

if __name__ == "__main__":
    train_and_save()
