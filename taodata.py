import requests
import json
import os
import shutil
import re
import customtkinter as ctk
from tkinter import messagebox
from threading import Thread, Lock
from queue import Queue
from pathlib import Path
import platform

# URL của AnkiConnect
ANKI_CONNECT_URL = "http://localhost:8765"

def anki_request(action, params):
    """Gửi yêu cầu đến AnkiConnect và trả về kết quả."""
    payload = {"action": action, "version": 6, "params": params}
    try:
        response = requests.post(ANKI_CONNECT_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        if result.get("error"):
            raise Exception(f"AnkiConnect error: {result['error']}")
        return result["result"]
    except Exception as e:
        print(f"Error in Anki request '{action}': {e}")
        return None

def get_decks():
    """Lấy danh sách tất cả deck từ Anki."""
    return anki_request("deckNames", {}) or []

def get_notes(deck_name):
    """Lấy tất cả note từ một deck."""
    query = f'deck:"{deck_name}"'
    note_ids = anki_request("findNotes", {"query": query})
    if not note_ids:
        return None
    notes = anki_request("notesInfo", {"notes": note_ids})
    return notes

def extract_sound_filename(sound_field):
    """Trích xuất tên file âm thanh từ trường sound."""
    match = re.match(r"\[sound:(.*?)\]", sound_field)
    return match.group(1) if match else None

def validate_note(note, sound_field, transcription_field, meaning_field):
    """Kiểm tra note và trả về lý do nếu không hợp lệ. Trường meaning có thể rỗng."""
    fields = note.get("fields", {})
    errors = []
    
    if not fields.get(sound_field) or not fields[sound_field]["value"]:
        errors.append(f"Missing or empty '{sound_field}' field")
    if not fields.get(transcription_field) or not fields[transcription_field]["value"]:
        errors.append(f"Missing or empty '{transcription_field}' field")
    if not fields.get(meaning_field):
        errors.append(f"Missing '{meaning_field}' field")
    
    return len(errors) == 0, errors

def sanitize_filename(name):
    """Làm sạch tên deck, lấy phần sau dấu :: và thay ký tự đặc biệt."""
    clean_name = name.split("::")[-1].strip()
    clean_name = re.sub(r'[^\w\-]', '_', clean_name)
    return clean_name

def clean_transcription(text):
    """Xóa ký tự không phải chữ ở đầu và cuối chuỗi transcription."""
    if not text:
        return text
    # Loại bỏ ký tự không phải chữ cái tiếng Đức ở đầu và cuối
    cleaned = re.sub(r'^[^a-zA-ZäöüÄÖÜß]+|[^a-zA-ZäöüÄÖÜß]+$', '', text)
    if cleaned != text:
        print(f"  Cleaned transcription: '{text}' -> '{cleaned}'")
    return cleaned

def process_deck(deck, output_dir, anki_media_path, valid_decks, invalid_decks, lock, field_names):
    """Xử lý một deck và tạo thư mục, file JSON, sao chép âm thanh."""
    sound_field, transcription_field, meaning_field = field_names
    print(f"Thread processing deck: {deck}")
    clean_deck_name = sanitize_filename(deck)
    deck_dir = os.path.join(output_dir, clean_deck_name)
    
    notes = get_notes(deck)
    if not notes:
        print(f"  No notes found in deck {deck}")
        with lock:
            invalid_decks.append((clean_deck_name, "No notes found"))
        return

    os.makedirs(deck_dir, exist_ok=True)
    valid_notes = []
    invalid_notes = []
    
    for note in notes:
        is_valid, errors = validate_note(note, sound_field, transcription_field, meaning_field)
        if not is_valid:
            print(f"  Skipping invalid note {note['noteId']} in deck {deck}: {', '.join(errors)}")
            invalid_notes.append((note['noteId'], errors))
            continue

        sound_file = extract_sound_filename(note["fields"][sound_field]["value"])
        if not sound_file:
            print(f"  Skipping note {note['noteId']} in deck {deck}: Invalid sound field format")
            invalid_notes.append((note['noteId'], ["Invalid sound field format"]))
            continue

        src_audio = os.path.join(anki_media_path, sound_file)
        dst_audio = os.path.join(deck_dir, sound_file)
        if os.path.exists(src_audio):
            shutil.copy2(src_audio, dst_audio)
        else:
            print(f"  Warning: Audio file {sound_file} not found for note {note['noteId']}")
            invalid_notes.append((note['noteId'], [f"Audio file {sound_file} not found"]))
            continue

        # Làm sạch transcription
        transcription = clean_transcription(note["fields"][transcription_field]["value"])
        if not transcription:
            print(f"  Skipping note {note['noteId']} in deck {deck}: Transcription empty after cleaning")
            invalid_notes.append((note['noteId'], ["Transcription empty after cleaning"]))
            continue

        valid_notes.append({
            "sound": sound_file,
            "transcription": transcription,
            "meaning": note["fields"][meaning_field]["value"] if note["fields"].get(meaning_field) else ""
        })

    if valid_notes:
        notes_file = os.path.join(deck_dir, "notes.json")
        with open(notes_file, "w", encoding="utf-8") as f:
            json.dump(valid_notes, f, ensure_ascii=False, indent=2)
        with lock:
            if clean_deck_name not in valid_decks:
                valid_decks.append(clean_deck_name)
    else:
        print(f"  No valid notes in deck {deck}, removing directory")
        shutil.rmtree(deck_dir)
        with lock:
            if invalid_notes:
                error_details = ", ".join([f"Note {nid}: {', '.join(errs)}" for nid, errs in invalid_notes])
                invalid_decks.append((clean_deck_name, f"No valid notes ({len(invalid_notes)} notes skipped: {error_details})"))
            else:
                invalid_decks.append((clean_deck_name, "No valid notes (no specific errors reported)"))

def worker(deck_queue, output_dir, anki_media_path, valid_decks, invalid_decks, lock, field_names):
    """Hàm worker cho mỗi thread, lấy deck từ queue và xử lý."""
    while not deck_queue.empty():
        try:
            deck = deck_queue.get_nowait()
        except Queue.Empty:
            break
        process_deck(deck, output_dir, anki_media_path, valid_decks, invalid_decks, lock, field_names)
        deck_queue.task_done()

def create_data_structure(selected_decks, output_dir, anki_media_path, field_names):
    """Tạo hoặc cập nhật cấu trúc thư mục data với 3 thread."""
    valid_decks = []
    invalid_decks = []
    lock = Lock()
    deck_queue = Queue()

    # Đọc danh sách deck hiện có từ decks.json (nếu tồn tại)
    decks_file = os.path.join(output_dir, "decks.json")
    if os.path.exists(decks_file):
        try:
            with open(decks_file, "r", encoding="utf-8") as f:
                valid_decks = json.load(f)
        except Exception as e:
            print(f"Error reading decks.json: {e}")

    # Chỉ thêm các deck chưa có vào queue
    for deck in selected_decks:
        clean_deck_name = sanitize_filename(deck)
        if clean_deck_name not in valid_decks:
            deck_queue.put(deck)

    threads = []
    for _ in range(3):
        t = Thread(target=worker, args=(deck_queue, output_dir, anki_media_path, valid_decks, invalid_decks, lock, field_names))
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    # Ghi lại toàn bộ danh sách valid_decks vào decks.json
    with open(decks_file, "w", encoding="utf-8") as f:
        json.dump(valid_decks, f, ensure_ascii=False, indent=2)

    return valid_decks, invalid_decks

def find_collection_media():
    """Tìm thư mục collection.media có nhiều file mp3 nhất trong Anki2."""
    anki2_paths = []
    system = platform.system()
    
    if system == "Windows":
        anki2_paths.append(Path(os.getenv("APPDATA")) / "Anki2")
    elif system == "Darwin":  # macOS
        anki2_paths.append(Path.home() / "Anki2")
    elif system == "Linux":
        anki2_paths.append(Path.home() / ".local/share/Anki2")
        anki2_paths.append(Path.home() / "Anki2")

    max_mp3_count = -1
    selected_media_path = None

    for anki2_path in anki2_paths:
        if not anki2_path.exists():
            continue
        for user_dir in anki2_path.iterdir():
            if user_dir.is_dir():
                media_path = user_dir / "collection.media"
                if media_path.exists() and media_path.is_dir():
                    mp3_count = len(list(media_path.glob("*.mp3")))
                    if mp3_count > max_mp3_count:
                        max_mp3_count = mp3_count
                        selected_media_path = media_path

    return str(selected_media_path) if selected_media_path else ""

class AnkiExportUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Xuất Bộ Thẻ Anki")
        self.root.geometry("700x650")
        ctk.set_appearance_mode("System")
        ctk.set_default_color_theme("blue")
        
        self.deck_vars = {}
        self.output_dir = ctk.StringVar(value=os.getcwd())
        self.anki_media_path = ctk.StringVar(value=find_collection_media())
        self.sound_field = ctk.StringVar(value="sound")
        self.transcription_field = ctk.StringVar(value="transcription")
        self.meaning_field = ctk.StringVar(value="meaning")
        
        self.create_widgets()
        self.load_decks()

    def create_widgets(self):
        # Frame cho Anki media path
        media_frame = ctk.CTkFrame(self.root)
        media_frame.pack(pady=10, padx=10, fill="x")
        ctk.CTkLabel(media_frame, text="Đường dẫn thư mục media của Anki:").pack(anchor="w", pady=5)
        ctk.CTkEntry(media_frame, textvariable=self.anki_media_path, width=500).pack(side="left", padx=5)
        ctk.CTkButton(media_frame, text="Chọn", command=self.browse_media_path, width=100).pack(side="left")

        # Frame cho output directory
        output_frame = ctk.CTkFrame(self.root)
        output_frame.pack(pady=10, padx=10, fill="x")
        ctk.CTkLabel(output_frame, text="Thư mục đầu ra:").pack(anchor="w", pady=5)
        ctk.CTkEntry(output_frame, textvariable=self.output_dir, width=500).pack(side="left", padx=5)
        ctk.CTkButton(output_frame, text="Chọn", command=self.browse_output_dir, width=100).pack(side="left")

        # Frame cho field names
        fields_frame = ctk.CTkFrame(self.root)
        fields_frame.pack(pady=10, padx=10, fill="x")
        ctk.CTkLabel(fields_frame, text="Tên các trường trong Anki (Meaning có thể rỗng):").pack(anchor="w", pady=5)
        fields_inner = ctk.CTkFrame(fields_frame)
        fields_inner.pack(fill="x")
        ctk.CTkLabel(fields_inner, text="Sound:").grid(row=0, column=0, padx=5, pady=5)
        ctk.CTkEntry(fields_inner, textvariable=self.sound_field, width=150).grid(row=0, column=1, padx=5)
        ctk.CTkLabel(fields_inner, text="Transcription:").grid(row=0, column=2, padx=5)
        ctk.CTkEntry(fields_inner, textvariable=self.transcription_field, width=150).grid(row=0, column=3, padx=5)
        ctk.CTkLabel(fields_inner, text="Meaning:").grid(row=0, column=4, padx=5)
        ctk.CTkEntry(fields_inner, textvariable=self.meaning_field, width=150).grid(row=0, column=5, padx=5)

        # Frame cho danh sách deck
        decks_frame = ctk.CTkFrame(self.root)
        decks_frame.pack(pady=10, padx=10, fill="both", expand=True)
        ctk.CTkLabel(decks_frame, text="Chọn bộ thẻ để xuất:").pack(anchor="w", pady=5)
        
        self.canvas = ctk.CTkCanvas(decks_frame)
        self.scrollbar = ctk.CTkScrollbar(decks_frame, orientation="vertical", command=self.canvas.yview)
        self.scrollable_frame = ctk.CTkFrame(self.canvas)
        
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        
        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")
        
        # Frame cho log
        log_frame = ctk.CTkFrame(self.root)
        log_frame.pack(pady=10, padx=10, fill="x")
        ctk.CTkLabel(log_frame, text="Thông tin xử lý:").pack(anchor="w", pady=5)
        self.log_text = ctk.CTkTextbox(log_frame, height=100, width=600)
        self.log_text.pack(fill="x")

        # Frame cho các nút hành động
        buttons_frame = ctk.CTkFrame(self.root)
        buttons_frame.pack(pady=10, padx=10, fill="x")
        ctk.CTkButton(buttons_frame, text="Làm mới danh sách", command=self.load_decks).pack(side="left", padx=10)
        ctk.CTkButton(buttons_frame, text="Xuất các bộ thẻ đã chọn", command=self.export_decks).pack(side="left", padx=10)

        # Bind mouse wheel
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)
        if platform.system() != "Windows":
            self.canvas.bind_all("<Button-4>", lambda e: self.canvas.yview_scroll(-1, "units"))
            self.canvas.bind_all("<Button-5>", lambda e: self.canvas.yview_scroll(1, "units"))

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    def browse_media_path(self):
        path = ctk.filedialog.askdirectory(title="Chọn thư mục media của Anki")
        if path:
            self.anki_media_path.set(path)

    def browse_output_dir(self):
        path = ctk.filedialog.askdirectory(title="Chọn thư mục đầu ra")
        if path:
            self.output_dir.set(path)

    def load_decks(self):
        # Xóa danh sách cũ
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.deck_vars.clear()

        decks = get_decks()
        if not decks:
            self.log_text.insert("end", "Lỗi: Không thể kết nối với AnkiConnect. Vui lòng đảm bảo Anki đang chạy.\n")
            messagebox.showerror("Lỗi", "Không thể kết nối với AnkiConnect. Vui lòng đảm bảo Anki đang chạy.")
            return
        
        for deck in decks:
            var = ctk.BooleanVar(value=False)
            self.deck_vars[deck] = var
            ctk.CTkCheckBox(self.scrollable_frame, text=deck, variable=var).pack(anchor="w", pady=2)

        self.log_text.insert("end", f"Đã tải {len(decks)} bộ thẻ từ Anki.\n")

    def export_decks(self):
        selected_decks = [deck for deck, var in self.deck_vars.items() if var.get()]
        if not selected_decks:
            self.log_text.insert("end", "Cảnh báo: Vui lòng chọn ít nhất một bộ thẻ.\n")
            messagebox.showwarning("Cảnh báo", "Vui lòng chọn ít nhất một bộ thẻ.")
            return
        
        if not self.anki_media_path.get():
            self.log_text.insert("end", "Cảnh báo: Vui lòng chỉ định đường dẫn thư mục media của Anki.\n")
            messagebox.showwarning("Cảnh báo", "Vui lòng chỉ định đường dẫn thư mục media của Anki.")
            return
        
        if not self.output_dir.get():
            self.log_text.insert("end", "Cảnh báo: Vui lòng chỉ định thư mục đầu ra.\n")
            messagebox.showwarning("Cảnh báo", "Vui lòng chỉ định thư mục đầu ra.")
            return
        
        field_names = (
            self.sound_field.get().strip(),
            self.transcription_field.get().strip(),
            self.meaning_field.get().strip()
        )
        
        self.log_text.insert("end", "Bắt đầu xuất các bộ thẻ...\n")
        try:
            output_dir = os.path.join(self.output_dir.get(), "data")
            valid_decks, invalid_decks = create_data_structure(selected_decks, output_dir, self.anki_media_path.get(), field_names)
            
            log_message = f"Xuất thành công {len(valid_decks)} bộ thẻ vào '{output_dir}':\n"
            if valid_decks:
                log_message += f"- Bộ thẻ hợp lệ: {', '.join(valid_decks)}\n"
            if invalid_decks:
                log_message += "Các bộ thẻ không hợp lệ:\n"
                for deck, reason in invalid_decks:
                    log_message += f"- {deck}: {reason}\n"
            
            self.log_text.insert("end", log_message)
            if valid_decks:
                messagebox.showinfo("Thành công", f"Đã xuất hoặc cập nhật {len(valid_decks)} bộ thẻ vào '{output_dir}'")
            else:
                messagebox.showwarning("Cảnh báo", "Không có bộ thẻ hợp lệ nào được xuất. Kiểm tra log để biết chi tiết.")
        except Exception as e:
            self.log_text.insert("end", f"Lỗi: Không thể xuất bộ thẻ: {e}\n")
            messagebox.showerror("Lỗi", f"Không thể xuất bộ thẻ: {e}")

def main():
    root = ctk.CTk()
    app = AnkiExportUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()
