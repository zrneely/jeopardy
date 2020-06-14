use std::path::Path;

use itertools::Itertools;
use serde::Deserialize;

use crate::game::board::{Category, Clue, Square};

#[derive(Debug, Deserialize)]
struct Row {
    row_id: u64,
    game_id: u64,
    air_date: String,
    air_year: String,
    r#type: RowType,
    cat_id: String,
    q_id: String,
    category: String,
    category_comm: String,
    clue_text: String,
    daily_double_flg: u8,
    answer_text: String,
    clue_link: String,
}
impl Row {
    fn to_square(&self) -> Square {
        Square::new(
            Clue {
                text: if self.clue_text.is_empty() {
                    None
                } else {
                    Some(self.clue_text.clone())
                },
                link: if self.clue_link.is_empty() {
                    None
                } else {
                    Some(self.clue_link.clone())
                },
            },
            self.answer_text.clone(),
        )
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
enum RowType {
    #[serde(rename = "J")]
    Jeopardy,
    #[serde(rename = "DJ")]
    DoubleJeopardy,
    #[serde(rename = "FJ")]
    FinalJeopardy,
}

pub fn load<P: AsRef<Path>>(path: P) -> Result<Vec<Category>, std::io::Error> {
    let mut reader = csv::Reader::from_path(path)?;
    let results = reader.deserialize::<Row>();

    let mut categories = Vec::new();

    let mut occurrences = [0usize; 5];

    for (_key, group) in results
        .filter_map(|row| row.ok())
        .filter(|row| !matches!(row.r#type, RowType::FinalJeopardy))
        // .filter(|row| !row.category_comm.is_empty())
        .group_by(|row| row.cat_id.clone())
        .into_iter()
    {
        let group: Vec<Row> = group.collect();
        assert!(group.len() == 5);

        for i in 0..5 {
            if group[i].daily_double_flg != 0 {
                occurrences[i] += 1;
            }
        }

        categories.push(Category {
            title: group[0].category.clone(),
            air_year: group[0].air_year.clone(),
            commentary: if group[0].category_comm.is_empty() {
                None
            } else {
                Some(group[0].category_comm.clone())
            },
            squares: [
                group[0].to_square(),
                group[1].to_square(),
                group[2].to_square(),
                group[3].to_square(),
                group[4].to_square(),
            ],
        });
    }

    log::info!("Occurrences of Daily Doubles: {:?}", occurrences);

    Ok(categories)
}
